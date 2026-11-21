import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {openDatabase} from "../src/db.mjs";
import {backupWithAttachments,verifyAttachmentBundle} from "../src/backup-bundle.mjs";
import {encryptVerifiedBundle} from "../src/backup-encrypted.mjs";
import {writePrivateAttachment} from "../src/attachments.mjs";

const AGE=process.env.TEAMS_AGE_BINARY;
const KEYGEN=AGE ? path.join(path.dirname(AGE),"age-keygen") : null;
const SAMPLE="private synthetic offline archive marker — never real user data";

async function syntheticBundle(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gct-age-test-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sourceFile=path.join(root,"source.sqlite");
  const attachmentDirectory=path.join(root,"source-attachments");
  const db=openDatabase(sourceFile);
  try {
    const user=randomUUID(),workspace=randomUUID(),channel=randomUUID(),message=randomUUID();
    const attachment=randomUUID(),stamp="2026-11-20T12:00:00.000Z";
    const contents=Buffer.from(SAMPLE,"utf8");
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)")
      .run(user,"archive_owner","Synthetic Owner","test-only-hash",stamp);
    db.prepare("INSERT INTO workspaces VALUES(?,?,?,?)")
      .run(workspace,"Synthetic Offline",user,stamp);
    db.prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(workspace,user,"owner");
    db.prepare("INSERT INTO channels(id,workspace_id,name,is_private,created_at,kind) VALUES(?,?,?,?,?,?)")
      .run(channel,workspace,"general",0,stamp,"channel");
    db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,NULL,NULL)")
      .run(message,channel,user,SAMPLE,null,stamp);
    writePrivateAttachment(attachmentDirectory,attachment,contents);
    db.prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)")
      .run(attachment,message,user,"synthetic.txt","text/plain",contents.length,
        createHash("sha256").update(contents).digest("hex"),stamp);
  } finally {db.close();}
  const bundleDirectory=path.join(root,"verified-bundle");
  await backupWithAttachments({sourceFile,attachmentDirectory,destinationDirectory:bundleDirectory});
  const outputDir=path.join(root,"encrypted");
  fs.mkdirSync(outputDir,{mode:0o700});
  return {root,bundleDirectory,outputDir};
}

function keypair(root,suffix) {
  const identity=path.join(root,"identity-"+suffix+".txt");
  const result=spawnSync(KEYGEN,["-o",identity],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  assert.equal(fs.statSync(identity).mode & 0o077,0);
  const publicKey=spawnSync(KEYGEN,["-y",identity],{encoding:"utf8"});
  assert.equal(publicKey.status,0,publicKey.stderr);
  assert.match(publicKey.stdout.trim(),/^age1[a-z0-9]{35,}$/);
  return {identity,recipient:publicKey.stdout.trim()};
}

test("encryption rejects weak or unsafe arguments without invoking age", async t=>{
  const f=await syntheticBundle(t);
  await assert.rejects(encryptVerifiedBundle({
    bundleDirectory:f.bundleDirectory,
    destinationFile:path.join(f.outputDir,"unsafe.tar.age"),
    recipient:"not-an-age-recipient",
    ageExecutable:"/definitely/not/age"
  }),/recipient/);
  const unsafeDir=path.join(f.root,"public");
  fs.mkdirSync(unsafeDir,{mode:0o755});
  await assert.rejects(encryptVerifiedBundle({
    bundleDirectory:f.bundleDirectory,
    destinationFile:path.join(unsafeDir,"unsafe.tar.age"),
    recipient:"age1"+"x".repeat(52),
    ageExecutable:"/definitely/not/age"
  }),/private/);
  assert.deepEqual(fs.readdirSync(f.outputDir),[]);
  assert.deepEqual(fs.readdirSync(unsafeDir),[]);
});

test("real age encrypts verified SQLite and blobs with atomic, no-overwrite ciphertext",{
  skip:!AGE || !fs.existsSync(AGE) || !fs.existsSync(KEYGEN)
}, async t=>{
  const f=await syntheticBundle(t);
  const owner=keypair(f.root,"owner");
  const outsider=keypair(f.root,"outsider");
  const encrypted=path.join(f.outputDir,"teams-synthetic.tar.age");
  // Hostile TAR_OPTIONS would replace the archive with help output if the
  // backup subprocess inherited this untrusted option from the shell.
  const savedTarOptions=process.env.TAR_OPTIONS;
  process.env.TAR_OPTIONS="--help";
  let result;
  try {
    result=await encryptVerifiedBundle({
      bundleDirectory:f.bundleDirectory,destinationFile:encrypted,
      recipient:owner.recipient,ageExecutable:AGE
    });
  } finally {
    if (savedTarOptions === undefined) delete process.env.TAR_OPTIONS;
    else process.env.TAR_OPTIONS=savedTarOptions;
  }
  assert.equal(result.destination,encrypted);
  assert.equal(result.attachmentCount,1);
  assert.equal(result.mode,"0600");
  assert.ok(result.encryptedBytes>128);
  assert.equal(fs.statSync(encrypted).mode & 0o777,0o600);
  assert.ok(fs.readFileSync(encrypted).subarray(0,22)
    .equals(Buffer.from("age-encryption.org/v1\n")));
  assert.equal(fs.readFileSync(encrypted).includes(Buffer.from(SAMPLE)),false);

  const decryptDir=path.join(f.root,"offline-restore");
  fs.mkdirSync(decryptDir,{mode:0o700});
  const archive=path.join(decryptDir,"restore.tar");
  const fd=fs.openSync(archive,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
  try {
    const decrypted=spawnSync(AGE,["-d","-i",owner.identity,encrypted],
      {stdio:["ignore",fd,"pipe"]});
    assert.equal(decrypted.status,0,decrypted.stderr?.toString("utf8"));
  }finally {fs.closeSync(fd);}
  const unpack=spawnSync("/usr/bin/tar",["-C",decryptDir,"-xf",archive],{encoding:"utf8"});
  assert.equal(unpack.status,0,unpack.stderr);
  assert.equal((await verifyAttachmentBundle({
    bundleDirectory:path.join(decryptDir,path.basename(f.bundleDirectory))
  })).attachmentCount,1);

  const denied=spawnSync(AGE,["-d","-i",outsider.identity,encrypted],
    {stdio:["ignore","ignore","pipe"]});
  assert.notEqual(denied.status,0,"incorrect identity cannot decrypt");
  const altered=path.join(f.outputDir,"altered.tar.age");
  const corrupted=fs.readFileSync(encrypted);
  corrupted[corrupted.length-1]^=0xff;
  fs.writeFileSync(altered,corrupted,{flag:"wx",mode:0o600});
  const rejected=spawnSync(AGE,["-d","-i",owner.identity,altered],
    {stdio:["ignore","ignore","pipe"]});
  assert.notEqual(rejected.status,0,"authenticated ciphertext tampering is rejected");

  const before=fs.readFileSync(encrypted);
  await assert.rejects(encryptVerifiedBundle({
    bundleDirectory:f.bundleDirectory,destinationFile:encrypted,
    recipient:owner.recipient,ageExecutable:AGE
  }),/already exists/);
  assert.deepEqual(fs.readFileSync(encrypted),before);
  assert.deepEqual(fs.readdirSync(f.outputDir).sort(),
    ["altered.tar.age","teams-synthetic.tar.age"]);

  const cliArchive=path.join(f.outputDir,"cli-synthetic.tar.age");
  const cli=spawnSync(process.execPath,[
    fileURLToPath(new URL("../../../scripts/backup-encrypt.mjs",import.meta.url)),
    "--bundle",f.bundleDirectory,"--recipient",owner.recipient,
    "--destination",cliArchive
  ],{encoding:"utf8",env:{...process.env,TEAMS_AGE_BINARY:AGE}});
  assert.equal(cli.status,0,cli.stderr);
  assert.ok(cli.stdout.includes("Verified bundle encrypted to a new private age v1 archive"));
  assert.ok(!cli.stdout.includes(SAMPLE));
  assert.equal(fs.statSync(cliArchive).mode & 0o077,0);
  fs.unlinkSync(cliArchive);

  const noBinary=path.join(f.outputDir,"no-binary.tar.age");
  await assert.rejects(encryptVerifiedBundle({
    bundleDirectory:f.bundleDirectory,destinationFile:noBinary,
    recipient:owner.recipient,ageExecutable:"/definitely/not/age"
  }));
  assert.equal(fs.existsSync(noBinary),false);

  fs.unlinkSync(path.join(f.bundleDirectory,"COMPLETE"));
  const invalidSource=path.join(f.outputDir,"invalid-source.tar.age");
  await assert.rejects(encryptVerifiedBundle({
    bundleDirectory:f.bundleDirectory,destinationFile:invalidSource,
    recipient:owner.recipient,ageExecutable:AGE
  }),/incomplete|ENOENT/);
  assert.equal(fs.existsSync(invalidSource),false);
});
