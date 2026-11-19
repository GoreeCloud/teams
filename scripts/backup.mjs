import { backupDatabase } from "../apps/server/src/backup.mjs";

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--source", "--destination"].includes(args[i]) || !args[i + 1]) {
      throw new Error("Usage: npm run backup -- --source /path/teams.sqlite --destination /private/teams-backup.sqlite");
    }
    result[args[i]] = args[i + 1];
  }
  const sourceFile = result["--source"] || process.env.TEAMS_DB_PATH;
  if (!sourceFile || !result["--destination"]) {
    throw new Error("Specify --source (or TEAMS_DB_PATH) and --destination");
  }
  return { sourceFile, destinationFile: result["--destination"] };
}

try {
  const result = await backupDatabase(parseArgs(process.argv.slice(2)));
  console.log("Verified SQLite backup:", result.destination, result.bytes + " bytes");
} catch (error) {
  console.error("SQLite backup failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}
