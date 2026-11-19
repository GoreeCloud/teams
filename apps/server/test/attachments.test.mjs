import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createServer } from "../src/server.mjs";
import { MAX_ATTACHMENT_BYTES } from "../src/attachments.mjs";

const call = (app, method, url, token, payload) => app.inject({
  method, url, payload, headers: token ? { authorization: "Bearer " + token } : {}
});
const uploadPayload = (bytes = Buffer.from("Safe synthetic sample\n")) => ({
  filename: "sample.txt", mimeType: "text/plain", dataBase64: bytes.toString("base64")
});

async function ownerAndChannel(app) {
  const owner = await call(app, "POST", "/api/auth/register", null, {
    username: "files_owner", displayName: "Files Owner", password: "synthetic-file-test-password-123"
  });
  assert.equal(owner.statusCode, 201, owner.body);
  const ownerToken = owner.json().accessToken;
  const workspace = (await call(app, "GET", "/api/workspaces", ownerToken)).json()[0];
  const ch = (await call(app, "GET", "/api/workspaces/" + workspace.id + "/channels", ownerToken))
    .json().find(channel => channel.name === "general");
  const invitation = await call(app, "POST", "/api/workspaces/" + workspace.id + "/invites",
    ownerToken, {});
  assert.equal(invitation.statusCode, 201);
  const member = await call(app, "POST", "/api/auth/register", null, {
    username: "files_member", displayName: "Files Member",
    password: "synthetic-file-test-password-123", invite: invitation.json().invite
  });
  assert.equal(member.statusCode, 201);
  const privateResponse = await call(app, "POST", "/api/workspaces/" + workspace.id + "/channels",
    ownerToken, { name: "file-private-room", isPrivate: true });
  assert.equal(privateResponse.statusCode, 201, privateResponse.body);
  return { ownerToken, memberToken: member.json().accessToken, workspace, general: ch,
    privateChannel: privateResponse.json() };
}

test("attachment upload fails closed without configured scanning", async t => {
  const app = createServer();
  t.after(async () => app.close());
  const { ownerToken, general } = await ownerAndChannel(app);
  const route = "/api/channels/" + general.id + "/attachments";
  assert.equal((await call(app, "POST", route, null, uploadPayload())).statusCode, 401);
  const rejected = await call(app, "POST", route, ownerToken, uploadPayload());
  assert.equal(rejected.statusCode, 503, rejected.body);
  assert.equal((await call(app, "GET", "/api/channels/" + general.id + "/messages",
    ownerToken)).json().length, 0);
});

test("scanned attachments require exact MIME, UTF-8, size and filename validation", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gct-attachment-check-"));
  let scans = 0;
  const directory = path.join(temp, "private");
  const app = createServer({
    attachmentDirectory: directory, scanAttachment: async () => {
      scans++; return { verdict: "clean" };
    }
  });
  t.after(async () => { await app.close(); fs.rmSync(temp, {recursive:true, force:true}); });
  const {ownerToken, general} = await ownerAndChannel(app);
  const route = "/api/channels/" + general.id + "/attachments";
  const invalid = [
    { ...uploadPayload(), filename: "../private" },
    { ...uploadPayload(), filename: "hello.txt.exe/next" },
    { ...uploadPayload(), filename: ".hidden" },
    { ...uploadPayload(), filename: "file..txt" },
    { ...uploadPayload(), filename: "file\nname.txt" },
    { ...uploadPayload(), mimeType: "text/html" },
    { ...uploadPayload(), mimeType: "image/svg+xml" },
    { ...uploadPayload(), mimeType: "application/pdf" },
    { ...uploadPayload(), mimeType: "image/png" },
    { ...uploadPayload(), dataBase64: "$unsafe" },
    { ...uploadPayload(), dataBase64: Buffer.from([0xff, 0xfe]).toString("base64") },
    { ...uploadPayload(), dataBase64: Buffer.from([0]).toString("base64") },
    { ...uploadPayload(), dataBase64: "Zg" },
    { ...uploadPayload(), dataBase64: "Zg==" + "AAA" },
    { ...uploadPayload(), dataBase64: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 65).toString("base64") },
    { ...uploadPayload(), caption: "" },
    { ...uploadPayload(), caption: "n".repeat(4001) }
  ];
  for (const data of invalid) {
    const r = await call(app, "POST", route, ownerToken, data);
    assert.ok([400, 413].includes(r.statusCode), JSON.stringify(data).slice(0, 140) + ":" + r.statusCode);
  }
  assert.equal(scans, 0, "invalid payloads must not reach the scanner");
  assert.equal(fs.existsSync(directory), false, "invalid bytes must not be written");
});

test("clean attachments are private, signed-by-scanner fixtures only, and deleted with their messages", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gct-attachment-storage-"));
  const directory = path.join(temp, "private");
  let verified = 0;
  const app = createServer({
    databaseFile: path.join(temp, "teams.sqlite"),
    attachmentDirectory: directory,
    scanAttachment: async ({bytes, filename, mimeType, sha256}) => {
      verified++;
      assert.ok(Buffer.isBuffer(bytes));
      assert.equal(filename, "private-brief.txt");
      assert.equal(mimeType, "text/plain");
      assert.match(sha256, /^[a-f0-9]{64}$/);
      return { verdict: "clean" };
    }
  });
  t.after(async () => { await app.close(); fs.rmSync(temp, { recursive:true, force:true }); });
  const {ownerToken, memberToken, workspace, general, privateChannel} = await ownerAndChannel(app);
  const secret = Buffer.from("synthetic family-private-note\n");
  const response = await call(app, "POST",
    "/api/channels/" + privateChannel.id + "/attachments", ownerToken,
    { ...uploadPayload(secret), filename: "private-brief.txt", caption: "See attached brief" });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(verified, 1);
  const message = response.json();
  assert.equal(message.body, "See attached brief");
  assert.equal(message.attachments.length, 1);
  const file = message.attachments[0];
  assert.deepEqual(Object.keys(file).sort(), ["filename", "id", "mimeType", "size"]);
  assert.equal(file.mimeType, "text/plain");
  assert.equal(file.size, secret.length);
  assert.equal((await call(app, "GET", "/api/channels/" + privateChannel.id + "/messages",
    memberToken)).statusCode, 404);
  assert.equal((await call(app, "GET", "/api/attachments/" + file.id, memberToken)).statusCode, 404);
  assert.equal((await call(app, "GET", "/api/attachments/" + file.id, null)).statusCode, 401);
  assert.equal((await call(app, "GET", "/api/attachments/not-an-id", ownerToken)).statusCode, 400);
  const download = await call(app, "GET", "/api/attachments/" + file.id, ownerToken);
  assert.equal(download.statusCode, 200, download.body);
  assert.deepEqual(download.rawPayload, secret);
  assert.match(download.headers["content-type"], /application\/octet-stream/);
  assert.equal(download.headers["content-disposition"], 'attachment; filename="private-brief.txt"');
  assert.equal(download.headers["x-content-type-options"], "nosniff");
  assert.equal(download.headers["cache-control"], "no-store");
  const stat = fs.statSync(path.join(directory, file.id));
  assert.equal(stat.mode & 0o777, 0o600);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  // Secret payload must never be exposed to an uninvolved workspace member's search.
  assert.equal((await call(app, "GET",
    "/api/workspaces/" + workspace.id + "/search?q=brief", memberToken)).json().length, 0);
  assert.equal((await call(app, "GET",
    "/api/workspaces/" + workspace.id + "/search?q=brief", ownerToken)).json().length, 1);
  // A public channel cannot use a private-channel message as a reply parent.
  const invalidParent = await call(app, "POST",
    "/api/channels/" + general.id + "/attachments", ownerToken,
    { ...uploadPayload(), parentId: message.id });
  assert.equal(invalidParent.statusCode, 400);
  // The stored file has no caller filename embedded in the path.
  assert.deepEqual(fs.readdirSync(directory), [file.id]);
  const erased = await call(app, "DELETE", "/api/messages/" + message.id, ownerToken);
  assert.equal(erased.statusCode, 200, erased.body);
  assert.deepEqual(erased.json().attachments, []);
  assert.equal(fs.existsSync(path.join(directory, file.id)), false);
  assert.equal((await call(app, "GET", "/api/attachments/" + file.id, ownerToken)).statusCode, 404);
});

test("malicious/indeterminate scanner results or storage tampering cannot publish private bytes", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gct-attachment-failclosed-"));
  const dir = path.join(temp, "storage");
  let verdict = "malicious";
  const app = createServer({
    attachmentDirectory: dir, scanAttachment: async () => {
      if (verdict === "throw") throw new Error("synthetic scanning outage");
      return { verdict };
    }
  });
  t.after(async () => { await app.close(); fs.rmSync(temp, { recursive:true, force:true }); });
  const {ownerToken, general} = await ownerAndChannel(app);
  const upload = data => call(app, "POST", "/api/channels/" + general.id + "/attachments",
    ownerToken, data);
  assert.equal((await upload(uploadPayload())).statusCode, 422);
  verdict = "unknown";
  assert.equal((await upload(uploadPayload())).statusCode, 503);
  verdict = "throw";
  assert.equal((await upload(uploadPayload())).statusCode, 503);
  assert.equal(fs.existsSync(dir), false);
  verdict = "clean";
  const r = await upload(uploadPayload());
  assert.equal(r.statusCode, 201, r.body);
  const id = r.json().attachments[0].id;
  const file = path.join(dir, id);
  fs.writeFileSync(file, "tampered");
  assert.equal((await call(app, "GET", "/api/attachments/" + id, ownerToken)).statusCode, 503);
});

test("upload authorization is rechecked when a scanner finishes after logout", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gct-attachment-race-"));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let called;
  const started = new Promise(resolve => { called = resolve; });
  const app = createServer({
    attachmentDirectory: path.join(temp, "attachments"),
    scanAttachment: async () => { called(); return gate; }
  });
  t.after(async () => { await app.close(); fs.rmSync(temp, { recursive:true, force:true }); });
  const {ownerToken, general} = await ownerAndChannel(app);
  const pending = call(app, "POST",
    "/api/channels/" + general.id + "/attachments", ownerToken, uploadPayload());
  await started;
  assert.equal((await call(app, "POST", "/api/auth/logout", ownerToken, {})).statusCode, 200);
  release({ verdict: "clean" });
  const response = await pending;
  assert.equal(response.statusCode, 401, response.body);
  assert.equal(fs.existsSync(path.join(temp, "attachments")), false);
});
