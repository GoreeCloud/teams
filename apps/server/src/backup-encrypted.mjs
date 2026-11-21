import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { verifyAttachmentBundle } from "./backup-bundle.mjs";

const HEADER = Buffer.from("age-encryption.org/v1\n");
const RECIPIENT = /^age1[a-z0-9]{20,2000}$/;

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw new Error(label + " must be an absolute path");
  }
  return path.resolve(value);
}

function executable(value, label) {
  const filename = absolute(value, label);
  const entry = fs.lstatSync(filename);
  if (!entry.isFile() || entry.isSymbolicLink() ||
      fs.realpathSync(filename) !== filename || !(entry.mode & 0o111) ||
      (entry.mode & 0o022)) {
    throw new Error(label + " must be a non-writable-by-others regular executable");
  }
  return filename;
}

function privateParent(filename) {
  const parent = path.dirname(filename);
  const entry = fs.lstatSync(parent);
  if (!entry.isDirectory() || entry.isSymbolicLink() ||
      fs.realpathSync(parent) !== parent || (entry.mode & 0o077)) {
    throw new Error("Encrypted destination parent must be a private real directory (0700)");
  }
  return parent;
}

function completed(process, label) {
  return new Promise((resolve, reject) => {
    process.once("error", () => reject(new Error(label + " could not start")));
    process.once("close", (code, signal) => code === 0
      ? resolve()
      : reject(new Error(label + " failed (" + (signal || code) + ")")));
  });
}

function checkAgeHeader(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const data = Buffer.alloc(HEADER.length);
    if (fs.readSync(fd, data, 0, data.length, 0) !== data.length ||
        !data.equals(HEADER)) {
      throw new Error("Encrypted output does not contain a valid age v1 header");
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Encrypt an already complete, immutable-by-operator SQLite+blob bundle.
 * Plaintext tar bytes go directly from tar to age via private pipes, never to
 * a temporary plaintext archive. The only published new file is ciphertext.
 *
 * External programs must be independently reviewed; this never downloads,
 * installs or runs a shell. Restore/identity custody are separate duties.
 */
export async function encryptVerifiedBundle({
  bundleDirectory, destinationFile, recipient,
  ageExecutable = "/usr/bin/age", tarExecutable = "/usr/bin/tar"
}) {
  const bundle = absolute(bundleDirectory, "Verified bundle");
  const destination = absolute(destinationFile, "Encrypted destination");
  if (!destination.endsWith(".tar.age")) {
    throw new Error("Encrypted archive destination must end with .tar.age");
  }
  if (typeof recipient !== "string" || !RECIPIENT.test(recipient)) {
    throw new Error("An explicit age X25519 recipient public key is required");
  }
  if (destination === bundle || destination.startsWith(bundle + path.sep)) {
    throw new Error("Encrypted archive must not be created inside the source bundle");
  }
  const parent = privateParent(destination);
  if (fs.existsSync(destination) || fs.lstatSync(parent).isSymbolicLink()) {
    throw new Error("Encrypted archive destination already exists or is unsafe");
  }
  const ageBinary = executable(ageExecutable, "age binary");
  const tarBinary = executable(tarExecutable, "tar binary");
  const verified = await verifyAttachmentBundle({ bundleDirectory: bundle });
  const temp = path.join(parent, "." + path.basename(destination) + "." +
    randomBytes(12).toString("hex") + ".partial");
  let fd, archiveProcess, ageProcess, published = false;
  try {
    fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT |
      fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    // Do not inherit TAR_OPTIONS, LD_PRELOAD, plugin locations or operator
    // environment surprises into trusted encryption/archive utilities.
    const childEnv = { PATH: "/usr/bin:/bin", LC_ALL: "C" };
    archiveProcess = spawn(tarBinary, [
      "-C", path.dirname(bundle), "-cf", "-", "--", path.basename(bundle)
    ], {stdio:["ignore", "pipe", "ignore"], env: childEnv});
    ageProcess = spawn(ageBinary, ["-r", recipient],
      {stdio:["pipe", fd, "ignore"], env: childEnv});
    const results = await Promise.allSettled([
      completed(archiveProcess, "tar archiving"),
      completed(ageProcess, "age encryption"),
      pipeline(archiveProcess.stdout, ageProcess.stdin)
    ]);
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
    fs.fsyncSync(fd);
    checkAgeHeader(temp);
    // Reverify source integrity after streaming. Operator must still keep
    // verified bundles immutable; no simultaneous malicious writes are safe.
    await verifyAttachmentBundle({bundleDirectory:bundle});
    // link() is atomic, same-filesystem and EXCL; it cannot replace an
    // existing file, including a symlink created by another process.
    fs.linkSync(temp, destination);
    published = true;
    fs.unlinkSync(temp);
    const parentFd = fs.openSync(parent, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); }
    const stat = fs.lstatSync(destination);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new Error("Encrypted archive permissions are unsafe");
    }
    return {
      destination, encryptedBytes:stat.size,
      attachmentCount:verified.attachmentCount,
      format:"age-encryption.org/v1",
      mode:"0600"
    };
  } finally {
    if (archiveProcess && archiveProcess.exitCode === null) archiveProcess.kill();
    if (ageProcess && ageProcess.exitCode === null) ageProcess.kill();
    if (fd !== undefined) fs.closeSync(fd);
    if (!published && fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
