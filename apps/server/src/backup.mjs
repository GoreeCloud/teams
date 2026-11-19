import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

function assertPath(value, description) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new TypeError(description + " must be a nonempty filesystem path");
  }
  return path.resolve(value);
}

/**
 * An online SQLite backup that includes live WAL transactions without copying
 * SQLite's open database file. This creates an independently verified snapshot.
 *
 * The staging directory (0700) protects the snapshot while SQLite writes it.
 * Atomic hard-link publication refuses to replace an existing destination.
 */
export async function backupDatabase({ sourceFile, destinationFile }) {
  const source = assertPath(sourceFile, "Source");
  const destination = assertPath(destinationFile, "Destination");
  if (source === destination || fs.realpathSync(source) === destination) {
    throw new Error("Backup destination must differ from source database");
  }
  if (!fs.statSync(source).isFile()) {
    throw new Error("Source database must be a regular file");
  }
  if (fs.existsSync(destination)) {
    throw new Error("Backup destination already exists");
  }
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  // mkdir may be a no-op when the directory is already present, so protect
  // intermediate files in a separate unpredictable private directory.
  const stageDir = fs.mkdtempSync(path.join(parent, ".teams-backup-"));
  fs.chmodSync(stageDir, 0o700);
  const stagedFile = path.join(stageDir, "snapshot.sqlite");
  let db;
  try {
    db = new Database(source, { readonly: true, fileMustExist: true });
    await db.backup(stagedFile);
    const snapshot = new Database(stagedFile, { readonly: true, fileMustExist: true });
    try {
      if (snapshot.pragma("integrity_check", { simple: true }) !== "ok") {
        throw new Error("Backup SQLite integrity verification failed");
      }
      if (snapshot.pragma("foreign_key_check").length !== 0) {
        throw new Error("Backup foreign key verification failed");
      }
    } finally {
      snapshot.close();
    }
    fs.chmodSync(stagedFile, 0o600);
    // Hard-link create is atomic and fails if the destination already exists.
    // Unlike rename(), it cannot silently overwrite an existing backup.
    fs.linkSync(stagedFile, destination);
    return {
      destination,
      bytes: fs.statSync(destination).size,
      integrity: "ok"
    };
  } finally {
    if (db) db.close();
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}
