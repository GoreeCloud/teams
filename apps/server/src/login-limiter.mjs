import { createHmac, randomBytes } from "node:crypto";

// One-process defense for an explicitly private/self-hosted application.
// Source IP addresses are never stored raw, logged or persisted. A per-process
// random HMAC key makes retained throttling identifiers opaque across restarts.
export function createLoginLimiter({
  windowMs = 15 * 60_000,
  maxFailures = 10,
  maxEntries = 2048,
  maxInFlight = 8,
  maxPerIpInFlight = 2,
  clock = Date.now
} = {}) {
  for (const [name, value] of Object.entries({
    windowMs, maxFailures, maxEntries, maxInFlight, maxPerIpInFlight
  })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid login limit: " + name);
  }
  const keySecret = randomBytes(32);
  const buckets = new Map();
  let active = 0, attempts = 0, lastCleanupAt = null;

  const hashedKey = ip => createHmac("sha256", keySecret)
    .update(typeof ip === "string" && ip.length <= 128 ? ip : "unknown")
    .digest("hex");

  const expired = (state, time) =>
    state.pending === 0 && (time < state.since || time - state.since >= windowMs);
  const cleanup = time => {
    for (const [key, state] of buckets) {
      if (expired(state, time)) buckets.delete(key);
    }
  };
  const begin = ip => {
    const time = clock();
    if (!Number.isFinite(time)) return null;
    // Periodic expiry cleanup prevents retaining IP-derived digests forever
    // in low-volume deployments, without requiring a background timer or
    // scanning the entire bounded map on every authentication request.
    const sweepInterval = Math.min(windowMs, 60_000);
    if ((++attempts % 64) === 0 || buckets.size >= maxEntries ||
        lastCleanupAt === null || time < lastCleanupAt ||
        time - lastCleanupAt >= sweepInterval) {
      cleanup(time);
      lastCleanupAt = time;
    }
    if (active >= maxInFlight) return null;

    const key = hashedKey(ip);
    let bucket = buckets.get(key);
    if (bucket && expired(bucket, time)) {
      buckets.delete(key);
      bucket = undefined;
    }
    if (!bucket) {
      if (buckets.size >= maxEntries) return null;
      bucket = { since: time, failures: 0, pending: 0 };
      buckets.set(key, bucket);
    }
    if (bucket.failures >= maxFailures || bucket.pending >= maxPerIpInFlight) return null;

    bucket.pending++;
    active++;
    let closed = false;
    return {
      finish(success) {
        if (closed) return;
        closed = true;
        bucket.pending--;
        active--;
        if (success === true) {
          bucket.failures = 0;
          if (bucket.pending === 0) buckets.delete(key);
          return;
        }
        const after = clock();
        if (Number.isFinite(after) &&
            (after < bucket.since || after - bucket.since >= windowMs)) {
          bucket.since = after;
          bucket.failures = 0;
        }
        bucket.failures++;
      }
    };
  };
  return {
    begin,
    stats: () => ({ retainedKeys: buckets.size, pending: active })
  };
}
