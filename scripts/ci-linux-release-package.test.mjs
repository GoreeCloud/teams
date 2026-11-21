import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const script=fileURLToPath(new URL("./ci-linux-release-package.sh",import.meta.url));
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gct-linux-bundle-test-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bundle=path.join(root,"generated","bundle");
  const data=path.join(bundle,"data");
  const assets=path.join(data,"flutter_assets");
  const libs=path.join(bundle,"lib");
  fs.mkdirSync(assets,{recursive:true,mode:0o700});
  fs.mkdirSync(libs,{mode:0o700});
  const exe=path.join(bundle,"goreecloud_teams");
  fs.writeFileSync(exe,"#!/bin/sh\nexit 0\n",{mode:0o755});
  fs.chmodSync(exe,0o755);
  fs.writeFileSync(path.join(data,"icudtl.dat"),"synthetic-ICU");
  fs.writeFileSync(path.join(assets,"AssetManifest.bin"),"synthetic-assets");
  fs.writeFileSync(path.join(libs,"libflutter_linux_gtk.so"),"synthetic-library");
  return {root,bundle};
}
function exec(...args) {
  return spawnSync(args[0],args.slice(1),{encoding:"utf8",timeout:10000});
}

test("synthetic Linux release bundle creates a checksum-verified, no-overwrite archive",t=>{
  const {root,bundle}=fixture(t);
  const output=path.join(root,"private-release-artifacts");
  const result=exec("bash",script,bundle,output);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Unsigned Linux release bundle/);
  assert.equal(fs.statSync(output).mode & 0o777,0o700);
  const archive=path.join(output,"goreecloud-teams-linux-x64-release-unsigned.tar.gz");
  const manifest=path.join(output,"SHA256SUMS");
  assert.equal(fs.statSync(archive).mode & 0o777,0o600);
  assert.ok(fs.readFileSync(manifest,"utf8").includes(path.basename(archive)));
  const checked=spawnSync("sha256sum",["-c","SHA256SUMS"],{cwd:output,encoding:"utf8"});
  assert.equal(checked.status,0,checked.stderr);
  const entries=exec("tar","-tzf",archive);
  assert.equal(entries.status,0,entries.stderr);
  for(const item of [
    "bundle/goreecloud_teams","bundle/data/icudtl.dat",
    "bundle/data/flutter_assets/AssetManifest.bin",
    "bundle/lib/libflutter_linux_gtk.so"
  ]) assert.ok(entries.stdout.includes(item),item);
  const original=fs.readFileSync(archive);
  const second=exec("bash",script,bundle,output);
  assert.notEqual(second.status,0,"existing output must never be replaced");
  assert.deepEqual(fs.readFileSync(archive),original);
  fs.appendFileSync(archive,Buffer.from("synthetic-tampering"));
  const corrupted=spawnSync("sha256sum",["-c","SHA256SUMS"],{cwd:output,encoding:"utf8"});
  assert.notEqual(corrupted.status,0,"post-creation modification breaks manifest");
});

test("refuses incomplete or nonprivate Linux release bundles",t=>{
  const {root,bundle}=fixture(t);
  const lib=path.join(bundle,"lib","libflutter_linux_gtk.so");
  fs.unlinkSync(lib);
  const incomplete=path.join(root,"incomplete");
  assert.notEqual(exec("bash",script,bundle,incomplete).status,0);
  assert.equal(fs.existsSync(incomplete),false);
  fs.writeFileSync(lib,"synthetic-library");

  const within=path.join(bundle,"unsafe-output");
  assert.notEqual(exec("bash",script,bundle,within).status,0);
  assert.equal(fs.existsSync(within),false);

  const openDir=path.join(root,"world-readable");
  fs.mkdirSync(openDir,{mode:0o755});
  fs.chmodSync(openDir,0o755);
  assert.notEqual(exec("bash",script,bundle,openDir).status,0);
  assert.equal(fs.readdirSync(openDir).length,0);
});
