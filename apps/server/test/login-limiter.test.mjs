import test from "node:test";
import assert from "node:assert/strict";
import { createLoginLimiter } from "../src/login-limiter.mjs";
import { createServer } from "../src/server.mjs";

test("login limiter is per IP and resets a failed window only after expiry", () => {
  let time = 1000;
  const limiter = createLoginLimiter({
    windowMs: 1000, maxFailures: 2, maxEntries: 4,
    maxInFlight: 3, maxPerIpInFlight: 2, clock: () => time
  });
  const a = limiter.begin("198.51.100.1");
  assert.ok(a);
  a.finish(false);
  a.finish(false);
  assert.deepEqual(limiter.stats(), {retainedKeys:1, pending:0});
  limiter.begin("198.51.100.1").finish(false);
  assert.equal(limiter.begin("198.51.100.1"), null);
  const other = limiter.begin("198.51.100.2");
  assert.ok(other, "unrelated IP is not locked out");
  other.finish(true);
  assert.equal(limiter.stats().retainedKeys, 1, "successful sign-in releases its bucket");
  time += 1001;
  const expired = limiter.begin("198.51.100.1");
  assert.ok(expired, "failure window resets after expiry");
  expired.finish(true);
  assert.deepEqual(limiter.stats(), {retainedKeys:0, pending:0});
});

test("simultaneous requests are bounded globally and per IP, including repeated finish", () => {
  const limiter = createLoginLimiter({
    maxFailures: 4, maxEntries: 8, maxInFlight: 2, maxPerIpInFlight: 1
  });
  const first = limiter.begin("198.51.100.1");
  assert.ok(first);
  assert.equal(limiter.begin("198.51.100.1"), null, "only one expensive concurrent check per IP");
  const second = limiter.begin("198.51.100.2");
  assert.ok(second);
  assert.equal(limiter.begin("198.51.100.3"), null, "global Argon2 concurrency bound");
  assert.deepEqual(limiter.stats(), {retainedKeys:2,pending:2});
  first.finish(false);
  first.finish(false);
  assert.deepEqual(limiter.stats(), {retainedKeys:2,pending:1});
  const third = limiter.begin("198.51.100.3");
  assert.ok(third, "capacity is reusable after request settlement");
  second.finish(true);
  third.finish(false);
  assert.deepEqual(limiter.stats(), {retainedKeys:2,pending:0});
});

test("IP state growth is bounded, stale failures are pruned, and unknown keys fail closed", () => {
  let time = 100;
  const limiter = createLoginLimiter({
    windowMs: 100, maxFailures: 2, maxEntries: 2,
    maxInFlight: 5, maxPerIpInFlight: 2, clock: () => time
  });
  limiter.begin("198.51.100.1").finish(false);
  limiter.begin("198.51.100.2").finish(false);
  assert.equal(limiter.begin("198.51.100.3"), null, "new IP fails closed at storage cap");
  assert.equal(limiter.stats().retainedKeys, 2);
  time += 101;
  const third = limiter.begin("198.51.100.3");
  assert.ok(third, "expired records are cleaned at capacity");
  assert.equal(limiter.stats().retainedKeys, 1);
  third.finish(false);
  time += 101;
  const fourth = limiter.begin("198.51.100.4");
  assert.ok(fourth, "stale inactive records are recyclable");
  assert.equal(limiter.stats().retainedKeys, 1);
  fourth.finish(true);
  for (const parameter of ["windowMs","maxFailures","maxEntries","maxInFlight","maxPerIpInFlight"]) {
    assert.throws(() => createLoginLimiter({[parameter]: 0}), /Invalid login limit/);
  }
});

const call = (app, method, url, payload) => app.inject({method, url, payload});

test("API keeps generic wrong-password responses and throttles repeated failures",
  {timeout: 30000}, async t => {
    const app = createServer({allowUnsafeMemoryBootstrap:true});
    t.after(async () => app.close());
    const owner = await call(app, "POST", "/api/auth/register", {
      username:"auth_rate_owner", displayName:"Owner",
      password:"synthetic-correct-login-password-12345"
    });
    assert.equal(owner.statusCode, 201, owner.body);
    for (let i=0;i<10;i++) {
      // The server must ignore untrusted X-Forwarded-For values because it
      // has no trusted proxy configuration. Header spoofing cannot reset limits.
      const attempted = await app.inject({
        method:"POST", url:"/api/auth/login",
        headers:{"x-forwarded-for": "198.51.100." + (i + 1)},
        payload:{username:"auth_rate_owner", password:"synthetic-wrong-password-123"}
      });
      assert.equal(attempted.statusCode, 401, attempted.body);
      assert.deepEqual(attempted.json(), {error:"Invalid credentials"});
    }
    const locked = await call(app, "POST", "/api/auth/login", {
      username:"auth_rate_owner", password:"synthetic-correct-login-password-12345"
    });
    assert.equal(locked.statusCode, 429);
    assert.equal(locked.json().error, "Too many attempts. Try again later.");
  });
