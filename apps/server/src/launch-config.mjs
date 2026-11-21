import path from "node:path";
import { isIP } from "node:net";

export class LaunchConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LaunchConfigurationError";
  }
}

const fail = message => { throw new LaunchConfigurationError(message); };
const get = (env, key, fallback) => env[key] === undefined ? fallback : env[key];

/**
 * Validate operator configuration before Fastify opens SQLite or binds a socket.
 * This is not a TLS proxy proof; it prevents accidental unsafe production
 * defaults when Teams is launched outside the vetted Compose entrypoint.
 */
export function readLaunchConfiguration(env = process.env) {
  const nodeEnv = get(env, "NODE_ENV", "");
  // A typo must not silently opt the official server out of production rules.
  if (!["", "development", "test", "production"].includes(nodeEnv)) {
    fail("NODE_ENV must be production, development or test");
  }
  const production = nodeEnv === "production";
  const origin = get(env, "TEAMS_SITE_ORIGIN", "");
  if (typeof origin !== "string" || origin !== origin.trim() ||
      /[\x00-\x1f\x7f]/.test(origin)) {
    fail("TEAMS_SITE_ORIGIN must be an exact public web origin");
  }
  if (production && !origin) {
    fail("Production requires TEAMS_SITE_ORIGIN (the external HTTPS origin)");
  }
  if (origin) {
    let url;
    try { url = new URL(origin); } catch {
      fail("TEAMS_SITE_ORIGIN must be a valid absolute web origin");
    }
    if (url.username || url.password || url.search || url.hash ||
        url.pathname !== "/" || !["https:","http:"].includes(url.protocol) ||
        url.origin !== origin) {
      fail("TEAMS_SITE_ORIGIN must be a canonical origin without path, userinfo, query or fragment");
    }
    if (production && (url.protocol !== "https:" ||
        url.hostname.endsWith(".example") ||
        url.hostname === "example.com" ||
        url.hostname.endsWith(".example.com"))) {
      fail("Production requires a real, non-placeholder HTTPS site origin");
    }
  }
  const rawPort = get(env, "PORT", "3030");
  if (typeof rawPort !== "string" || !/^\d{1,5}$/.test(rawPort)) {
    fail("PORT must be a numeric TCP port");
  }
  const port=Number(rawPort);
  if (port > 65535 || (production && port === 0)) {
    fail("PORT must be within the valid server listen range");
  }
  const host=get(env,"HOST","127.0.0.1");
  // An IP address or simple RFC1123 hostname, not an arbitrary shell path.
  const hostname=/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
  if (typeof host!=="string" || (!isIP(host) && !hostname.test(host))) {
    fail("HOST must be a valid IP address or hostname");
  }
  const databaseFile=get(env,"TEAMS_DB_PATH","./data/teams.sqlite");
  if (typeof databaseFile!=="string" || !databaseFile.trim() ||
      databaseFile.includes("\0") || (production && !path.isAbsolute(databaseFile))) {
    fail("Production TEAMS_DB_PATH must be an absolute nonempty file path");
  }
  const attachmentDirectory=get(env,"TEAMS_ATTACHMENT_DIRECTORY",null);
  if (attachmentDirectory && (typeof attachmentDirectory!=="string" ||
      attachmentDirectory.includes("\0") ||
      (production && !path.isAbsolute(attachmentDirectory)))) {
    fail("Production TEAMS_ATTACHMENT_DIRECTORY must be an absolute path");
  }
  return Object.freeze({
    databaseFile, siteOrigin:origin, port, host,
    attachmentDirectory:attachmentDirectory || null,
    // The raw secret is passed only to the account bootstrap check and is never
    // emitted by this config parser, thrown errors or /api/config.
    bootstrapToken:get(env,"TEAMS_BOOTSTRAP_TOKEN",null) || null
  });
}
