import fs from "node:fs";
import path from "node:path";

export class PrivateDatabaseError extends Error {
  constructor(message) {
    super(message);
    this.name = "PrivateDatabaseError";
  }
}

const fail = message => { throw new PrivateDatabaseError(message); };
const owner = stats => typeof process.getuid !== "function" ||
  stats.uid === process.getuid();
const samePath = location => fs.realpathSync(location) === location;

function statIfPresent(location) {
  try { return fs.lstatSync(location); }
  catch (err) { if (err?.code === "ENOENT") return null; throw err; }
}

function assertPrivateFile(location, label) {
  const stat = statIfPresent(location);
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink() || !owner(stat) ||
      (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 ||
      !samePath(location)) {
    fail(label + " must be a single-owner regular file (0600), not a symlink/hardlink");
  }
  return true;
}

/**
 * New SQLite databases are EXCL-created with mode 0600 before SQLite opens.
 * SQLite derives its WAL/SHM permissions from the owner-only main file.
 * Existing non-private files/directories fail closed; no silent chmod of
 * operator data is performed and no existing bytes are overwritten.
 */
export function preparePrivateDatabaseFile(filename) {
  if (typeof filename !== "string" || !filename || filename.includes("\0")) {
    fail("SQLite filename must be a nonempty filesystem path");
  }
  const location=path.resolve(filename);
  const directory=path.dirname(location);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const dirStat=fs.lstatSync(directory);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() ||
      !owner(dirStat) || (dirStat.mode & 0o777) !== 0o700 ||
      !samePath(directory)) {
    fail("SQLite directory must be a real owner-only directory (0700)");
  }
  if (!assertPrivateFile(location,"SQLite database")) {
    // O_EXCL preserves fail-closed semantics if a second process creates the
    // same path between validation and open. O_NOFOLLOW denies symlink races.
    const fd=fs.openSync(location,
      fs.constants.O_WRONLY | fs.constants.O_CREAT |
      fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,0o600);
    fs.closeSync(fd);
  }
  verifyPrivateDatabaseFiles(location);
  return location;
}

export function verifyPrivateDatabaseFiles(filename) {
  const location=path.resolve(filename);
  if (!assertPrivateFile(location,"SQLite database")) {
    fail("SQLite database is missing");
  }
  for (const suffix of ["-wal","-shm","-journal"]) {
    assertPrivateFile(location+suffix,"SQLite "+suffix+" sidecar");
  }
}
