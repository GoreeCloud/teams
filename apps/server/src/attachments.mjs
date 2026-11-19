import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_WORKSPACE_ATTACHMENT_BYTES = 128 * 1024 * 1024;
export const ATTACHMENT_BODY_LIMIT = 2_900_000;

const namePattern = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;
const allowedMime = new Set(["text/plain", "image/png", "image/jpeg"]);
const sha256 = data => createHash("sha256").update(data).digest("hex");

export function validateAttachment(input) {
  const filename = input?.filename;
  const mimeType = input?.mimeType;
  const encoded = input?.dataBase64;
  if (typeof filename !== "string" || !namePattern.test(filename) ||
      filename.includes("..") || /[. ]$/.test(filename)) {
    return { error: "Invalid attachment filename" };
  }
  if (!allowedMime.has(mimeType)) return { error: "Attachment type not supported" };
  if (typeof encoded !== "string" || encoded.length === 0 ||
      encoded.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return { error: "Invalid or oversized attachment encoding" };
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES ||
      bytes.toString("base64") !== encoded) {
    return { error: "Invalid or oversized attachment bytes" };
  }
  if (mimeType === "text/plain") {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return { error: "Plain text attachment must be valid UTF-8" }; }
    if (bytes.includes(0)) return { error: "Plain text attachment contains NUL" };
  }
  if (mimeType === "image/png" &&
      !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { error: "PNG signature does not match attachment type" };
  }
  if (mimeType === "image/jpeg" &&
      !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 &&
        bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217)) {
    return { error: "JPEG boundaries do not match attachment type" };
  }
  return { filename, mimeType, bytes, size: bytes.length, digest: sha256(bytes) };
}

export async function verifiedScan(scanner, attachment) {
  if (typeof scanner !== "function") return { error: "Attachment scanner unavailable", status: 503 };
  // Scanner implementations must honor the abort signal; Promise.race keeps
  // request handlers from being held open by a stalled remote verifier.
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("scan timed out")); }, 10_000);
    });
    const inspected = await Promise.race([
      Promise.resolve().then(() => scanner({
        bytes: Buffer.from(attachment.bytes),
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sha256: attachment.digest,
        signal: controller.signal
      })), timeout
    ]);
    if (inspected?.verdict === "clean") return { ok: true };
    if (inspected?.verdict === "malicious") return { error: "Attachment rejected by scanner", status: 422 };
    return { error: "Attachment could not be verified", status: 503 };
  } catch {
    return { error: "Attachment scanner unavailable", status: 503 };
  } finally {
    controller.abort();
    if (timer) clearTimeout(timer);
  }
}

// Storage keys are generated UUIDs, never caller filenames or paths.
// Do not traverse symlinks inside the private attachment directory.
export function ensurePrivateAttachmentDir(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new Error("An absolute private attachment directory is required");
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error("Attachment directory must be a private real directory (0700)");
  }
  return directory;
}

export function writePrivateAttachment(directory, id, bytes) {
  const dest = path.join(ensurePrivateAttachmentDir(directory), id);
  const fd = fs.openSync(dest, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } catch (e) {
    try { fs.unlinkSync(dest); } catch { /* best effort for partial write */ }
    throw e;
  } finally { fs.closeSync(fd); }
}

export function readPrivateAttachment(directory, id, size, digest) {
  const dest = path.join(ensurePrivateAttachmentDir(directory), id);
  const fd = fs.openSync(dest, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size !== size || info.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment storage size mismatch");
    }
    const bytes = fs.readFileSync(fd);
    if (sha256(bytes) !== digest) throw new Error("Attachment storage hash mismatch");
    return bytes;
  } finally { fs.closeSync(fd); }
}

export function deletePrivateAttachment(directory, id) {
  try { fs.unlinkSync(path.join(ensurePrivateAttachmentDir(directory), id)); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
}
