import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";

const script=fileURLToPath(new URL("./ci-android-maven-backoff.sh",import.meta.url));

function runScenario(t,mode) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gct-maven429-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bin=path.join(root,"bin");
  fs.mkdirSync(bin,{mode:0o700});
  const state=path.join(root,"state");
  const sleeps=path.join(root,"sleeps");
  fs.writeFileSync(path.join(bin,"flutter"),`#!/bin/sh
[ "$1" = build ] && [ "$2" = apk ] && [ "$3" = --debug ] || exit 19
n=0
if [ -r "$STATE_FILE" ]; then n=$(cat "$STATE_FILE"); fi
n=$((n + 1))
printf '%s\\n' "$n" > "$STATE_FILE"
case "$SCENARIO" in
  maven-transient)
    if [ "$n" -lt 3 ]; then
      echo "Could not GET https://repo.maven.apache.org/maven2/mock.pom Received status code 429 Too Many Requests" >&2
      exit 1
    fi
    echo "BUILD SUCCEEDED"; exit 0;;
  maven-persistent)
    echo "Could not GET https://repo.maven.apache.org/maven2/mock.pom Received status code 429" >&2
    exit 1;;
  compiler)
    echo "Error: Unresolved symbol in synthetic app" >&2
    exit 3;;
  other429)
    echo "Other network service reported 429 Too Many Requests" >&2
    exit 7;;
  *) exit 27;;
esac
`,{mode:0o700});
  fs.writeFileSync(path.join(bin,"sleep"),`#!/bin/sh
printf '%s\\n' "$1" >> "$SLEEP_FILE"
exit 0
`,{mode:0o700});
  const env={...process.env,PATH:bin+":"+process.env.PATH,
    STATE_FILE:state,SLEEP_FILE:sleeps,SCENARIO:mode};
  const result=spawnSync("bash",[script],{encoding:"utf8",timeout:15000,env});
  const count=Number(fs.readFileSync(state,"utf8").trim());
  const waited=fs.existsSync(sleeps)?fs.readFileSync(sleeps,"utf8").trim().split("\n"):[];
  return {result,count,waited};
}

test("retries exactly twice for Maven Central 429, then accepts actual build success",t=>{
  const {result,count,waited}=runScenario(t,"maven-transient");
  assert.equal(result.status,0,result.stderr);
  assert.equal(count,3);
  assert.deepEqual(waited,["20","40"]);
  assert.match(result.stdout,/BUILD SUCCEEDED/);
});

test("does not retry compiler failures or unrelated HTTP 429s",t=>{
  for(const mode of ["compiler","other429"]) {
    const {result,count,waited}=runScenario(t,mode);
    assert.notEqual(result.status,0);
    assert.equal(count,1);
    assert.deepEqual(waited,[]);
  }
});

test("persistent Maven 429 is reported as failure after bounded attempts",t=>{
  const {result,count,waited}=runScenario(t,"maven-persistent");
  assert.equal(result.status,1);
  assert.equal(count,3);
  assert.deepEqual(waited,["20","40"]);
  assert.match(result.stderr,/budget exhausted/);
});
