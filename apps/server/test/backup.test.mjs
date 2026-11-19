import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "../src/db.mjs";
import { backupDatabase } from "../src/backup.mjs";

test("online WAL snapshot contains committed state and is private and restorable", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teams-verified-backup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourceFile = path.join(dir, "live.sqlite");
  const destFile = path.join(dir, "backups", "snapshot.sqlite");
  const live = openDatabase(sourceFile);
  t.after(() => live.close());
  live.prepare("INSERT INTO users(id,username,display_name,password_hash,created_at) VALUES (?,?,?,?,?)")
    .run("u1", "fixture", "Fixture", "synthetic-never-real-password", "2026-01-01T00:00:00Z");
  const result = await backupDatabase({ sourceFile, destinationFile: destFile });
  assert.equal(result.destination, destFile);
  assert.ok(result.bytes > 0);
  assert.equal(result.integrity, "ok");
  assert.equal(fs.statSync(destFile).mode & 0o077, 0, "no group/other file access");
  assert.deepEqual(fs.readdirSync(path.dirname(destFile)), ["snapshot.sqlite"]);
  const restored = new Database(destFile, { readonly: true });
  assert.equal(restored.prepare("SELECT username FROM users WHERE id=?").get("u1").username, "fixture");
  assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
  restored.close();

});

test("never overwrites a backup, never backs up to the source, and rejects a missing database", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teams-backup-refuse-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourceFile = path.join(dir, "live.sqlite");
  const db = openDatabase(sourceFile);
  db.close();
  const destFile = path.join(dir, "existing.sqlite");
  fs.writeFileSync(destFile, "preexisting content");
  await assert.rejects(backupDatabase({ sourceFile, destinationFile: destFile }), /already exists/);
  assert.equal(fs.readFileSync(destFile, "utf8"), "preexisting content");
  await assert.rejects(backupDatabase({ sourceFile, destinationFile: sourceFile }), /differ/);
  await assert.rejects(backupDatabase({ sourceFile: path.join(dir, "missing"), destinationFile: path.join(dir, "future") }), /ENOENT/);
});
