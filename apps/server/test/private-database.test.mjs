import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db.mjs";
import {
  preparePrivateDatabaseFile, verifyPrivateDatabaseFiles, PrivateDatabaseError
} from "../src/private-database.mjs";

function directory(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gct-private-sqlite-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
const mode = file => fs.lstatSync(file).mode & 0o777;
const expectedError = callback => assert.throws(callback,error=>
  error instanceof PrivateDatabaseError &&
  /owner-only|0600|0700|symlink|hardlink/.test(error.message));

test("SQLite, WAL and SHM inherit owner-only 0600 under permissive umask",t=>{
  const root=directory(t);
  const file=path.join(root,"created-private","app.sqlite");
  const previous=process.umask(0o022);
  try {
    const db=openDatabase(file);
    try {
      db.prepare("INSERT INTO users VALUES (?,?,?,?,?)")
        .run("synthetic-user","synthetic_login","Synthetic Owner",
          "unit-test-placeholder-not-a-password-hash",new Date().toISOString());
      assert.equal(mode(path.dirname(file)),0o700);
      for (const name of [file,file+"-wal",file+"-shm"]) {
        assert.equal(mode(name),0o600,"must not expose "+path.basename(name));
      }
      assert.equal(fs.lstatSync(file).nlink,1);
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.prepare("UPDATE users SET display_name=? WHERE id=?")
        .run("Synthetic Owner Updated","synthetic-user");
      for (const name of [file,file+"-wal",file+"-shm"]) {
        assert.equal(mode(name),0o600,"WAL cycling must keep private permissions");
      }
    }finally{db.close();}
    const reopened=openDatabase(file);
    try {
      assert.equal(reopened.prepare("SELECT display_name FROM users WHERE id=?")
        .get("synthetic-user").display_name,"Synthetic Owner Updated");
    }finally{reopened.close();}
  }finally{process.umask(previous);}
});

test("unsafe existing 0644 database fails closed without modifying private data",t=>{
  const root=directory(t),file=path.join(root,"existing.sqlite");
  const original=Buffer.from("synthetic previous database bytes");
  fs.writeFileSync(file,original,{flag:"wx",mode:0o644});
  fs.chmodSync(file,0o644);
  expectedError(()=>openDatabase(file));
  assert.deepEqual(fs.readFileSync(file),original);
  assert.equal(mode(file),0o644,"the guard does not silently chmod data");
});

test("rejects unsafe existing SQLite sidecars before opening the database",t=>{
  const root=directory(t),file=path.join(root,"private.sqlite");
  fs.writeFileSync(file,"",{flag:"wx",mode:0o600});
  const wal=file+"-wal";
  fs.writeFileSync(wal,"synthetic unsafe sidecar",{flag:"wx",mode:0o644});
  fs.chmodSync(wal,0o644);
  expectedError(()=>openDatabase(file));
  assert.equal(fs.readFileSync(wal,"utf8"),"synthetic unsafe sidecar");
  assert.equal(mode(wal),0o644);
  fs.chmodSync(wal,0o600);
  assert.doesNotThrow(()=>preparePrivateDatabaseFile(file));
  assert.doesNotThrow(()=>verifyPrivateDatabaseFiles(file));
});

test("unsafe directory, symlink and hardlink locations reject without creating a database",t=>{
  const root=directory(t);
  const publicDir=path.join(root,"public-parent");
  fs.mkdirSync(publicDir,{mode:0o755});
  fs.chmodSync(publicDir,0o755);
  const exposed=path.join(publicDir,"database.sqlite");
  expectedError(()=>openDatabase(exposed));
  assert.equal(fs.existsSync(exposed),false);
  assert.equal(mode(publicDir),0o755);

  const privateDir=path.join(root,"private-dir");
  fs.mkdirSync(privateDir,{mode:0o700});
  const normal=path.join(privateDir,"safe.sqlite");
  fs.writeFileSync(normal,"synthetic",{flag:"wx",mode:0o600});
  const linked=path.join(privateDir,"alias.sqlite");
  fs.symlinkSync(normal,linked);
  expectedError(()=>preparePrivateDatabaseFile(linked));
  assert.equal(fs.lstatSync(linked).isSymbolicLink(),true);

  const second=path.join(privateDir,"hardlink.sqlite");
  fs.linkSync(normal,second);
  expectedError(()=>preparePrivateDatabaseFile(normal));
  expectedError(()=>preparePrivateDatabaseFile(second));

  const linkDirectory=path.join(root,"alias-directory");
  fs.symlinkSync(privateDir,linkDirectory,"dir");
  expectedError(()=>preparePrivateDatabaseFile(path.join(linkDirectory,"other.sqlite")));
  assert.equal(fs.existsSync(path.join(privateDir,"other.sqlite")),false);
});

test("in-memory test fixtures remain unmodified, container's private volume is explicit",t=>{
  const db=openDatabase(":memory:");
  try {
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
      .get().name,"messages");
  } finally {db.close();}
  const dockerfile=fs.readFileSync(fileURLToPath(new URL("../../../Dockerfile",import.meta.url)),"utf8");
  assert.match(dockerfile,/chmod 0700 \/data/);
});
