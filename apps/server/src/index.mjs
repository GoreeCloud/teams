import { createServer } from "./server.mjs";

const app = createServer({
  databaseFile: process.env.TEAMS_DB_PATH || "./data/teams.sqlite",
  siteOrigin: process.env.TEAMS_SITE_ORIGIN || "",
  // First-owner setup secret is supplied by the operator, never by /api/config.
  bootstrapToken: process.env.TEAMS_BOOTSTRAP_TOKEN || null,
  serveWeb: true,
  // Scanning is intentionally not wired into the shipped server. Providing a
  // private directory alone never enables uploads.
  attachmentDirectory: process.env.TEAMS_ATTACHMENT_DIRECTORY || null,
});
const port = Number(process.env.PORT || 3030);
const host = process.env.HOST || "127.0.0.1";
try {
  await app.listen({ port, host });
  app.log.info("Teams listening on " + host + ":" + port);
} catch (err) {
  app.log.error(err);
  process.exitCode = 1;
}
