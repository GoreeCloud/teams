import { createServer } from "./server.mjs";
import { LaunchConfigurationError, readLaunchConfiguration } from "./launch-config.mjs";

let app;
try {
  // Fail closed before opening SQLite or starting the listener. Compose supplies
  // a secure external origin; direct production launches must do the same.
  const launch = readLaunchConfiguration(process.env);
  app = createServer({
    databaseFile: launch.databaseFile,
    siteOrigin: launch.siteOrigin,
    bootstrapToken: launch.bootstrapToken,
    serveWeb: true,
    // An attachment path alone never enables uploads without a verified scanner.
    attachmentDirectory: launch.attachmentDirectory
  });
  await app.listen({ port:launch.port, host:launch.host });
  app.log.info("Teams listening on " + launch.host + ":" + launch.port);
} catch (error) {
  if (app) {
    try { await app.close(); } catch { /* A failed listen still exits closed. */ }
  }
  // Operator configuration errors are static, nonsecret strings. Avoid
  // printing raw environment, database contents, or a bootstrap token.
  if (error instanceof LaunchConfigurationError) {
    console.error("Teams startup configuration rejected: " + error.message);
  } else {
    console.error("Teams startup failed before a verified listener was available");
  }
  process.exitCode = 1;
}
