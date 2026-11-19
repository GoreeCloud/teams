import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { backupDatabase } from "./backup.mjs";
import {
  ensurePrivateAttachmentDir, readPrivateAttachment,
  writePrivateAttachment, MAX_ATTACHMENT_BYTES
} from "./attachments.mjs";

const BUNDLE_VERSION = 1;
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const attachmentId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function absolute(value, description) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") ||
      !path.isAbsolute(value)) {
    throw new Error(description + " must be an absolute filesystem path");
  }
  return path.resolve(value);
}

function privateDirectory(directory) {
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      fs.realpathSync(directory) !== directory ||
      (info.mode & 0o077) !== 0) {
    throw new Error("Private attachment directory must be a real directory with 0700 permissions");
  }
}

function within(ancestor, candidate) {
  const relative = path.relative(ancestor, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) &&
    relative !== ".." && !path.isAbsolute(relative));
}

function validMetadata(row) {
  if (!attachmentId.test(row.id) ||
      !Number.isSafeInteger(row.size) || row.size <= 0 ||
      row.size > MAX_ATTACHMENT_BYTES || !digestPattern.test(row.sha256)) {
    throw new Error("Invalid attachment metadata in SQLite snapshot");
  }
  return { id: row.id, size: row.size, sha256: row.sha256 };
}

function databaseRows(databaseFile) {
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma("integrity_check", { simple: true }) !== "ok" ||
        db.pragma("foreign_key_check").length !== 0) {
      throw new Error("SQLite snapshot integrity verification failed");
    }
    const rows = db.prepare(
      "SELECT id,size,sha256 FROM attachments ORDER BY id"
    ).all().map(validMetadata);
    if (rows.some((row, i) => i && rows[i - 1].id === row.id)) {
      throw new Error("Duplicate attachment ID in SQLite snapshot");
    }
    return rows;
  } finally {
    db.close();
  }
}

function makeStandaloneSnapshot(databaseFile) {
  // The SQLite online backup can inherit WAL journal mode. Convert only the
  // newly created, private snapshot to DELETE so a recovered bundle does not
  // silently depend on untracked -wal/-shm sidecars created by readonly opens.
  const db = new Database(databaseFile, {fileMustExist:true});
  try {
    if (db.pragma("journal_mode = DELETE", {simple:true}) !== "delete") {
      throw new Error("Could not finalize standalone SQLite journal");
    }
    if (db.pragma("integrity_check", {simple:true}) !== "ok" ||
        db.pragma("foreign_key_check").length !== 0) {
      throw new Error("Finalized SQLite snapshot is not intact");
    }
  } finally {
    db.close();
  }
  for (const suffix of ["-wal","-shm"]) {
    if (fs.existsSync(databaseFile + suffix)) {
      throw new Error("Unexpected SQLite sidecar in finalized backup bundle");
    }
  }
}

async function hashFile(filename) {
  const digest = createHash("sha256");
  for await (const bytes of fs.createReadStream(filename)) digest.update(bytes);
  return digest.digest("hex");
}

function writePrivateFile(filename, contents) {
  const fd = fs.openSync(filename, fs.constants.O_WRONLY |
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

function readManifest(dir) {
  const location = path.join(dir, "manifest.json");
  const stat = fs.lstatSync(location);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 || stat.size > MAX_MANIFEST_BYTES) {
    throw new Error("Bundle manifest must be a private regular file");
  }
  const bytes = fs.readFileSync(location);
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Invalid bundle manifest"); }
  if (manifest?.formatVersion !== BUNDLE_VERSION ||
      !digestPattern.test(manifest?.databaseSha256) ||
      !Array.isArray(manifest?.attachments) ||
      !Number.isSafeInteger(manifest?.attachmentCount) ||
      manifest.attachmentCount !== manifest.attachments.length) {
    throw new Error("Unexpected bundle manifest structure");
  }
  return { bytes, manifest };
}

/**
 * Verify an already published, immutable-by-operator bundle. Does not mutate
 * either the source or the bundle. Never trust a success marker alone.
 */
export async function verifyAttachmentBundle({ bundleDirectory }) {
  const dir = absolute(bundleDirectory, "Bundle");
  privateDirectory(dir);
  const marker = path.join(dir, "COMPLETE");
  const markerStat = fs.lstatSync(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink() ||
      (markerStat.mode & 0o077) !== 0 || markerStat.size !== 65) {
    throw new Error("Bundle is incomplete");
  }
  const expectedFiles = ["COMPLETE","attachments","database.sqlite","manifest.json"];
  if (JSON.stringify(fs.readdirSync(dir).sort()) !== JSON.stringify(expectedFiles)) {
    throw new Error("Unexpected files in private backup bundle");
  }
  const { bytes, manifest } = readManifest(dir);
  if (fs.readFileSync(marker, "utf8") !== hash(bytes) + "\n") {
    throw new Error("Bundle completion checksum mismatch");
  }
  const databaseFile = path.join(dir, "database.sqlite");
  const dbStat = fs.lstatSync(databaseFile);
  if (!dbStat.isFile() || dbStat.isSymbolicLink() || (dbStat.mode & 0o077) !== 0) {
    throw new Error("Backup database must be a private regular file");
  }
  if (await hashFile(databaseFile) !== manifest.databaseSha256) {
    throw new Error("Backup SQLite digest mismatch");
  }
  const referenced = databaseRows(databaseFile);
  if (JSON.stringify(referenced) !== JSON.stringify(manifest.attachments)) {
    throw new Error("Bundle manifest does not match the SQLite attachment table");
  }
  const attachmentsDirectory = path.join(dir, "attachments");
  privateDirectory(attachmentsDirectory);
  const actual = fs.readdirSync(attachmentsDirectory).sort();
  if (actual.length !== referenced.length ||
      actual.some((id, index) => id !== referenced[index].id)) {
    throw new Error("Unexpected or missing attachment files in bundle");
  }
  let attachmentBytes = 0;
  for (const row of referenced) {
    const entry = fs.lstatSync(path.join(attachmentsDirectory, row.id));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0) {
      throw new Error("Bundle attachment file is not private and regular");
    }
    // This checks exact stored size, content digest and O_NOFOLLOW on read.
    readPrivateAttachment(attachmentsDirectory, row.id, row.size, row.sha256);
    attachmentBytes += row.size;
  }
  return {
    directory: dir, integrity: "ok",
    attachmentCount: referenced.length,
    attachmentBytes, databaseBytes: dbStat.size
  };
}

/**
 * Bundle an online SQLite WAL snapshot with precisely the private attachment
 * blobs referenced by that snapshot. An upload/deletion racing this snapshot
 * may cause failure, never a published partial COMPLETE bundle.
 *
 * This is plaintext operator-managed backup data, not encrypted off-host
 * replication or a substitute for an independent staged restore drill.
 */
export async function backupWithAttachments({
  sourceFile, attachmentDirectory, destinationDirectory
}) {
  const source = absolute(sourceFile, "Source SQLite database");
  const sourceDir = absolute(attachmentDirectory, "Source attachments");
  const destination = absolute(destinationDirectory, "Bundle destination");
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() ||
      fs.realpathSync(source) !== source) {
    throw new Error("Source SQLite database must be a regular file");
  }
  privateDirectory(sourceDir);
  if (within(sourceDir, destination) || within(destination, sourceDir) ||
      within(destination, source)) {
    throw new Error("Bundle destination must not overlap original application data");
  }
  if (fs.existsSync(destination)) throw new Error("Bundle destination already exists");
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  // mkdir without recursive is exclusive: an existing directory is never
  // overwritten, and a failed bundle is removed before reporting success.
  fs.mkdirSync(destination, { mode: 0o700 });
  let completed = false;
  try {
    const databaseFile = path.join(destination, "database.sqlite");
    await backupDatabase({ sourceFile: source, destinationFile: databaseFile });
    makeStandaloneSnapshot(databaseFile);
    const rows = databaseRows(databaseFile);
    const blobDest = path.join(destination, "attachments");
    ensurePrivateAttachmentDir(blobDest);
    for (const row of rows) {
      const bytes = readPrivateAttachment(sourceDir, row.id, row.size, row.sha256);
      writePrivateAttachment(blobDest, row.id, bytes);
    }
    const databaseSha256 = await hashFile(databaseFile);
    const manifest = {
      formatVersion: BUNDLE_VERSION,
      databaseSha256,
      attachmentCount: rows.length,
      attachments: rows
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest) + "\n", "utf8");
    if (manifestBytes.length > MAX_MANIFEST_BYTES) {
      throw new Error("Attachment manifest exceeds maximum size");
    }
    writePrivateFile(path.join(destination, "manifest.json"), manifestBytes);
    // Published LAST. Readers refuse to use any bundle lacking a verified
    // COMPLETE checksum, preventing silent recovery from partial writes.
    writePrivateFile(path.join(destination, "COMPLETE"), hash(manifestBytes) + "\n");
    const result = await verifyAttachmentBundle({ bundleDirectory: destination });
    completed = true;
    return result;
  } finally {
    if (!completed) fs.rmSync(destination, { recursive: true, force: true });
  }
}
