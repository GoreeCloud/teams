import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { openDatabase } from "../src/db.mjs";
import { createServer } from "../src/server.mjs";
import { writePrivateAttachment } from "../src/attachments.mjs";
import { backupWithAttachments, verifyAttachmentBundle } from "../src/backup-bundle.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const PASSWORD = "synthetic-backup-fixture-password-12345";

async function fixture(t,{withAttachment = true} = {}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gct-bundle-test-"));
  const databaseFile=path.join(root,"source.sqlite");
  const attachmentDirectory=path.join(root,"private-attachments");
  const db=openDatabase(databaseFile);
  t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
  const userId=randomUUID(),workspaceId=randomUUID(),channelId=randomUUID();
  const messageId=randomUUID(),attachmentId=randomUUID();
  const passwordHash=await argon2.hash(PASSWORD,{type:argon2.argon2id});
  const timestamp="2026-11-19T12:00:00.000Z";
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)")
    .run(userId,"bundle_owner","Bundle Owner",passwordHash,timestamp);
  db.prepare("INSERT INTO workspaces VALUES(?,?,?,?)")
    .run(workspaceId,"Bundle workspace",userId,timestamp);
  db.prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(workspaceId,userId,"owner");
  db.prepare("INSERT INTO channels(id,workspace_id,name,is_private,created_at,kind) VALUES(?,?,?,?,?,?)")
    .run(channelId,workspaceId,"general",0,timestamp,"channel");
  db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,NULL,NULL)")
    .run(messageId,channelId,userId,"Private synthetic attachment message",null,timestamp);
  // A real SQLite WAL transaction is still openable through backupDatabase.
  const bytes=Buffer.from("synthetic personal archive: not real user data\n");
  if(withAttachment) {
    writePrivateAttachment(attachmentDirectory,attachmentId,bytes);
    db.prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)")
      .run(attachmentId,messageId,userId,"archive.txt","text/plain",bytes.length,sha(bytes),timestamp);
  } else {
    fs.mkdirSync(attachmentDirectory,{mode:0o700});
  }
  return {root,databaseFile,attachmentDirectory,db,attachmentId,bytes,userId};
}

test("private bundle captures committed WAL and attachment bytes with checksums and mode controls", async t=>{
  const f=await fixture(t);
  const destinationDirectory=path.join(f.root,"offsite-staging","bundle-v1");
  const result=await backupWithAttachments({
    sourceFile:f.databaseFile,
    attachmentDirectory:f.attachmentDirectory,destinationDirectory
  });
  assert.equal(result.directory,destinationDirectory);
  assert.equal(result.integrity,"ok");
  assert.equal(result.attachmentCount,1);
  assert.equal(result.attachmentBytes,f.bytes.length);
  assert.equal((await verifyAttachmentBundle({bundleDirectory:destinationDirectory})).attachmentCount,1);
  const all=fs.readdirSync(destinationDirectory).sort();
  assert.deepEqual(all,["COMPLETE","attachments","database.sqlite","manifest.json"]);
  assert.deepEqual(fs.readdirSync(path.join(destinationDirectory,"attachments")),[f.attachmentId]);
  assert.equal(fs.statSync(destinationDirectory).mode & 0o777,0o700);
  assert.equal(fs.statSync(path.join(destinationDirectory,"attachments")).mode & 0o777,0o700);
  for(const filename of ["COMPLETE","database.sqlite","manifest.json"]) {
    assert.equal(fs.statSync(path.join(destinationDirectory,filename)).mode & 0o077,0);
  }
  assert.equal(fs.statSync(path.join(destinationDirectory,"attachments",f.attachmentId)).mode & 0o077,0);
  assert.deepEqual(fs.readFileSync(path.join(destinationDirectory,"attachments",f.attachmentId)),f.bytes);

  // Staged, isolated restore with fresh paths. Do not mutate a backup in place.
  const restoredDir=path.join(f.root,"staging-restore");
  fs.mkdirSync(restoredDir,{mode:0o700});
  const restoredDb=path.join(restoredDir,"restored.sqlite");
  const restoredAttachments=path.join(restoredDir,"attachments");
  fs.copyFileSync(path.join(destinationDirectory,"database.sqlite"),restoredDb);
  fs.chmodSync(restoredDb,0o600);
  fs.cpSync(path.join(destinationDirectory,"attachments"),restoredAttachments,{recursive:true});
  fs.chmodSync(restoredAttachments,0o700);
  const app=createServer({databaseFile:restoredDb,attachmentDirectory:restoredAttachments});
  t.after(async()=>app.close());
  const login=await app.inject({
    method:"POST",url:"/api/auth/login",
    payload:{username:"bundle_owner",password:PASSWORD}
  });
  assert.equal(login.statusCode,200,login.body);
  const download=await app.inject({
    method:"GET",url:"/api/attachments/"+f.attachmentId,
    headers:{authorization:"Bearer "+login.json().accessToken}
  });
  assert.equal(download.statusCode,200,download.body);
  assert.deepEqual(download.rawPayload,f.bytes);
});

test("a blank attachment table publishes a complete empty private bundle",async t=>{
  const f=await fixture(t,{withAttachment:false});
  const dest=path.join(f.root,"empty-bundle");
  const result=await backupWithAttachments({
    sourceFile:f.databaseFile,attachmentDirectory:f.attachmentDirectory,
    destinationDirectory:dest
  });
  assert.equal(result.attachmentCount,0);
  assert.deepEqual(fs.readdirSync(path.join(dest,"attachments")),[]);
  assert.equal((await verifyAttachmentBundle({bundleDirectory:dest})).integrity,"ok");
});

test("source blob integrity failure never publishes an incomplete bundle",async t=>{
  const f=await fixture(t);
  const file=path.join(f.attachmentDirectory,f.attachmentId);
  fs.writeFileSync(file,"tampered synthetic content");
  const dest=path.join(f.root,"tampered-fail");
  await assert.rejects(backupWithAttachments({
    sourceFile:f.databaseFile,attachmentDirectory:f.attachmentDirectory,
    destinationDirectory:dest
  }),/mismatch/);
  assert.equal(fs.existsSync(dest),false,"partial bundle is removed");
});

test("existing destination is never overwritten; overlapping or symlink paths are rejected",async t=>{
  const f=await fixture(t);
  const existing=path.join(f.root,"existing");
  fs.mkdirSync(existing,{mode:0o700});
  fs.writeFileSync(path.join(existing,"PRESERVE"),"preexisting backup");
  await assert.rejects(backupWithAttachments({
    sourceFile:f.databaseFile,attachmentDirectory:f.attachmentDirectory,
    destinationDirectory:existing
  }),/already exists/);
  assert.equal(fs.readFileSync(path.join(existing,"PRESERVE"),"utf8"),"preexisting backup");
  await assert.rejects(backupWithAttachments({
    sourceFile:f.databaseFile,attachmentDirectory:f.attachmentDirectory,
    destinationDirectory:path.join(f.attachmentDirectory,"recursive")
  }),/overlap/);
  assert.equal(fs.existsSync(path.join(f.attachmentDirectory,"recursive")),false);
  const linked=path.join(f.root,"symlinked-source");
  fs.symlinkSync(f.attachmentDirectory,linked);
  await assert.rejects(backupWithAttachments({
    sourceFile:f.databaseFile,attachmentDirectory:linked,
    destinationDirectory:path.join(f.root,"bad-symlink")
  }),/real directory/);
  assert.equal(fs.existsSync(path.join(f.root,"bad-symlink")),false);
});

test("verification refuses altered bytes, extra blob files and modified manifests",async t=>{
  const f=await fixture(t);
  const dest=path.join(f.root,"verify-bundle");
  const options={
    sourceFile:f.databaseFile,attachmentDirectory:f.attachmentDirectory,
    destinationDirectory:dest
  };
  await backupWithAttachments(options);
  const stored=path.join(dest,"attachments",f.attachmentId);
  fs.writeFileSync(stored,"synthetic tamper");
  await assert.rejects(verifyAttachmentBundle({bundleDirectory:dest}),/mismatch/);
  fs.writeFileSync(stored,f.bytes);
  assert.equal((await verifyAttachmentBundle({bundleDirectory:dest})).attachmentCount,1);
  fs.writeFileSync(path.join(dest,"attachments",randomUUID()),"extra");
  await assert.rejects(verifyAttachmentBundle({bundleDirectory:dest}),/Unexpected or missing/);
  const extras=fs.readdirSync(path.join(dest,"attachments")).filter(id=>id!==f.attachmentId);
  for(const id of extras) fs.unlinkSync(path.join(dest,"attachments",id));
  const marker=path.join(dest,"COMPLETE");
  fs.writeFileSync(marker,"0".repeat(64)+"\n");
  await assert.rejects(verifyAttachmentBundle({bundleDirectory:dest}),/checksum mismatch/);
});

test("malicious SQLite attachment IDs and missing blobs reject a complete backup",async t=>{
  const f=await fixture(t);
  const invalid=path.join(f.root,"invalid-metadata");
  f.db.prepare("UPDATE attachments SET id=? WHERE id=?")
    .run("../unsafe-path",f.attachmentId);
  await assert.rejects(backupWithAttachments({
    sourceFile:f.databaseFile,attachmentDirectory:f.attachmentDirectory,
    destinationDirectory:invalid
  }),/Invalid attachment metadata/);
  assert.equal(fs.existsSync(invalid),false);
  f.db.prepare("UPDATE attachments SET id=? WHERE id=?").run(f.attachmentId,"../unsafe-path");
  fs.unlinkSync(path.join(f.attachmentDirectory,f.attachmentId));
  const missing=path.join(f.root,"missing-blob");
  await assert.rejects(backupWithAttachments({
    sourceFile:f.databaseFile,attachmentDirectory:f.attachmentDirectory,
    destinationDirectory:missing
  }));
  assert.equal(fs.existsSync(missing),false);
});
