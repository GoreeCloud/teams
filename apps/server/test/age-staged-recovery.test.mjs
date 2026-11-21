import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import argon2 from "argon2";
import {openDatabase} from "../src/db.mjs";
import {createServer} from "../src/server.mjs";
import {writePrivateAttachment} from "../src/attachments.mjs";
import {backupWithAttachments,verifyAttachmentBundle} from "../src/backup-bundle.mjs";
import {encryptVerifiedBundle} from "../src/backup-encrypted.mjs";

const AGE=process.env.TEAMS_AGE_BINARY;
const KEYGEN=AGE ? path.join(path.dirname(AGE),"age-keygen") : "";
const PASSWORD="synthetic-age-recovery-acceptance-credential-only";
const STAMP="2026-11-20T12:00:00.000Z";
const SENTINEL="synthetic confidential recovery payload, no personal data";
const sha=value=>createHash("sha256").update(value).digest("hex");
const request=(app,method,url,secret,payload)=>app.inject({
  method,url,payload,headers:secret?{authorization:"Bearer "+secret}:{}
});

test("decrypt a real age archive and recover authenticated, private Teams behavior",{
  timeout:15000,
  skip:!AGE || !fs.existsSync(AGE) || !fs.existsSync(KEYGEN)
},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gct-age-live-staging-"));
  let restoredServer;
  t.after(async()=>{
    if(restoredServer) await restoredServer.close();
    fs.rmSync(root,{recursive:true,force:true});
  });
  const sourceDb=path.join(root,"source.sqlite");
  const sourceBlobs=path.join(root,"source-private-attachments");
  const identities=path.join(root,"identities");
  const cipherDir=path.join(root,"ciphertext");
  const extraction=path.join(root,"decrypted-staging");
  const service=path.join(root,"isolated-recovery-instance");
  for(const dir of [identities,cipherDir,extraction,service]) {
    fs.mkdirSync(dir,{mode:0o700});
  }
  const owner=randomUUID(),member=randomUUID(),workspace=randomUUID();
  const privateChannel=randomUUID(),messageId=randomUUID(),attachmentId=randomUUID();
  const blob=Buffer.from(SENTINEL+"\n","utf8");
  const hash=await argon2.hash(PASSWORD,{type:argon2.argon2id});
  const db=openDatabase(sourceDb);
  try {
    for(const [id,name] of [[owner,"synthetic_restore_owner"],[member,"synthetic_restore_member"]]) {
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?)")
        .run(id,name,name,hash,STAMP);
    }
    db.prepare("INSERT INTO workspaces VALUES(?,?,?,?)")
      .run(workspace,"Offline Recovery Workspace",owner,STAMP);
    for(const [id,role] of [[owner,"owner"],[member,"member"]]) {
      db.prepare("INSERT INTO memberships VALUES(?,?,?)")
        .run(workspace,id,role);
    }
    db.prepare("INSERT INTO channels(id,workspace_id,name,is_private,created_at,kind) VALUES(?,?,?,?,?,?)")
      .run(privateChannel,workspace,"private-recovery",1,STAMP,"channel");
    db.prepare("INSERT INTO channel_members VALUES(?,?)").run(privateChannel,owner);
    db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,NULL,NULL)")
      .run(messageId,privateChannel,owner,SENTINEL,null,STAMP);
    db.prepare("INSERT INTO pinned_messages VALUES(?,?,?,?)")
      .run(messageId,privateChannel,owner,STAMP);
    writePrivateAttachment(sourceBlobs,attachmentId,blob);
    db.prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)")
      .run(attachmentId,messageId,owner,"synthetic.txt","text/plain",blob.length,sha(blob),STAMP);
  }finally{db.close();}

  const bundle=path.join(root,"verified-bundle");
  const original=await backupWithAttachments({
    sourceFile:sourceDb,attachmentDirectory:sourceBlobs,destinationDirectory:bundle
  });
  assert.equal(original.attachmentCount,1);
  assert.equal((await verifyAttachmentBundle({bundleDirectory:bundle})).integrity,"ok");
  const privateIdentity=path.join(identities,"synthetic-only-age-key.txt");
  const key=spawnSync(KEYGEN,["-o",privateIdentity],{encoding:"utf8"});
  assert.equal(key.status,0,"synthetic age key generation must succeed");
  assert.equal(fs.statSync(privateIdentity).mode & 0o077,0);
  const publicKey=spawnSync(KEYGEN,["-y",privateIdentity],{encoding:"utf8"});
  assert.equal(publicKey.status,0);
  const recipient=publicKey.stdout.trim();
  assert.match(recipient,/^age1[a-z0-9]{35,}$/);
  const encrypted=path.join(cipherDir,"archive.tar.age");
  await encryptVerifiedBundle({
    bundleDirectory:bundle,destinationFile:encrypted,recipient,ageExecutable:AGE
  });
  assert.equal(fs.statSync(encrypted).mode & 0o777,0o600);
  assert.equal(fs.readFileSync(encrypted).includes(blob),false);

  // Verify the full encrypted envelope with age before exposing any tar
  // extraction or live application. A partial decrypt is never trusted.
  const rawArchive=path.join(extraction,"authenticated.tar");
  const out=fs.openSync(rawArchive,fs.constants.O_CREAT|fs.constants.O_EXCL|
    fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  try {
    const decrypted=spawnSync(AGE,["-d","-i",privateIdentity,encrypted],
      {stdio:["ignore",out,"pipe"]});
    assert.equal(decrypted.status,0,"age decryption must fully authenticate");
  }finally{fs.closeSync(out);}
  const listed=spawnSync("/usr/bin/tar",["-tf",rawArchive],{encoding:"utf8"});
  assert.equal(listed.status,0,listed.stderr);
  const actual=listed.stdout.trim().split("\n").sort();
  const expected=[
    "verified-bundle/","verified-bundle/COMPLETE","verified-bundle/manifest.json",
    "verified-bundle/database.sqlite","verified-bundle/attachments/",
    "verified-bundle/attachments/"+attachmentId
  ].sort();
  assert.deepEqual(actual,expected,
    "only the exact synthetic six-entry archive layout may be extracted");
  const unpack=spawnSync("/usr/bin/tar",[
    "--no-same-owner","--no-same-permissions","-xf",rawArchive,"-C",extraction
  ],{encoding:"utf8"});
  assert.equal(unpack.status,0,unpack.stderr);
  const recoveredBundle=path.join(extraction,"verified-bundle");
  const verified=await verifyAttachmentBundle({bundleDirectory:recoveredBundle});
  assert.equal(verified.attachmentCount,1);

  // The verified immutable backup is not itself opened as an application
  // database: copy into separate private writable staging state.
  const restoredDb=path.join(service,"restored.sqlite");
  const restoredBlobs=path.join(service,"private-attachments");
  fs.copyFileSync(path.join(recoveredBundle,"database.sqlite"),restoredDb,
    fs.constants.COPYFILE_EXCL);
  fs.chmodSync(restoredDb,0o600);
  fs.cpSync(path.join(recoveredBundle,"attachments"),restoredBlobs,{recursive:true});
  // Copy helpers may create directory mode 0775 even when source was 0700.
  // The operator-controlled *staged copy*, never the immutable backup, must
  // be hardened before the recovered service can be allowed to open it.
  fs.chmodSync(restoredBlobs,0o700);
  for(const name of fs.readdirSync(restoredBlobs)) {
    assert.match(name,/^[0-9a-f-]{36}$/);
    const blobPath=path.join(restoredBlobs,name);
    assert.equal(fs.lstatSync(blobPath).isFile(),true);
    fs.chmodSync(blobPath,0o600);
    assert.equal(fs.statSync(blobPath).mode & 0o777,0o600);
  }
  assert.equal(fs.statSync(restoredBlobs).mode & 0o777,0o700);
  assert.equal(fs.statSync(restoredDb).mode & 0o777,0o600);
  assert.equal(fs.statSync(service).mode & 0o777,0o700);

  restoredServer=createServer({
    databaseFile:restoredDb,attachmentDirectory:restoredBlobs
  });
  const ownerLogin=await request(restoredServer,"POST","/api/auth/login",null,{
    username:"synthetic_restore_owner",password:PASSWORD
  });
  assert.equal(ownerLogin.statusCode,200,ownerLogin.body);
  const ownerToken=ownerLogin.json().accessToken;
  const memberLogin=await request(restoredServer,"POST","/api/auth/login",null,{
    username:"synthetic_restore_member",password:PASSWORD
  });
  assert.equal(memberLogin.statusCode,200,memberLogin.body);
  const memberToken=memberLogin.json().accessToken;
  const privatePins=await request(restoredServer,"GET",
    "/api/channels/"+privateChannel+"/pins",ownerToken);
  assert.equal(privatePins.statusCode,200,privatePins.body);
  assert.equal(privatePins.json()[0].id,messageId);
  const privateBlob=await request(restoredServer,"GET",
    "/api/attachments/"+attachmentId,ownerToken);
  assert.equal(privateBlob.statusCode,200,privateBlob.body);
  assert.deepEqual(privateBlob.rawPayload,blob);
  const blockedPin=await request(restoredServer,"GET",
    "/api/channels/"+privateChannel+"/pins",memberToken);
  const blockedBlob=await request(restoredServer,"GET",
    "/api/attachments/"+attachmentId,memberToken);
  assert.equal(blockedPin.statusCode,404);
  assert.equal(blockedBlob.statusCode,404);

  const logout=await request(restoredServer,"POST","/api/auth/logout",ownerToken,{});
  assert.equal(logout.statusCode,200,logout.body);
  const revoked=await request(restoredServer,"GET",
    "/api/attachments/"+attachmentId,ownerToken);
  assert.equal(revoked.statusCode,401);
  const afterRecovery=await request(restoredServer,"POST","/api/auth/login",null,{
    username:"synthetic_restore_owner",password:PASSWORD
  });
  assert.equal(afterRecovery.statusCode,200,afterRecovery.body);
  assert.equal((await request(restoredServer,"GET","/api/workspaces",
    afterRecovery.json().accessToken)).json()[0].id,workspace);

  // The immutable backup and encrypted archive remain intact after server
  // operations; the live restore only mutates its independent staged copy.
  assert.equal((await verifyAttachmentBundle({bundleDirectory:recoveredBundle})).integrity,"ok");
  assert.equal((await verifyAttachmentBundle({bundleDirectory:bundle})).integrity,"ok");
  assert.equal(fs.readFileSync(encrypted).includes(blob),false);
});
