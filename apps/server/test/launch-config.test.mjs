import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readLaunchConfiguration, LaunchConfigurationError } from "../src/launch-config.mjs";

const syntheticProduction = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  PORT: "3030",
  TEAMS_SITE_ORIGIN: "https://teams.goreecloud.com",
  TEAMS_DB_PATH: "/data/teams.sqlite",
  TEAMS_ATTACHMENT_DIRECTORY: "/data/private-attachments",
  TEAMS_BOOTSTRAP_TOKEN: "synthetic-server-setup-token-no-secret-used-000000000"
};
const bad = (overrides,pattern) => assert.throws(
  () => readLaunchConfiguration({...syntheticProduction,...overrides}),
  error=>error instanceof LaunchConfigurationError && pattern.test(error.message)
);

test("production startup rejects missing, HTTP, placeholder and noncanonical origins",()=>{
  for (const url of [
    "", "http://teams.goreecloud.com", "https://teams.yourdomain.example",
    "https://example.com", "https://dev.example.com",
    "https://teams.goreecloud.com/path",
    "https://user:password@teams.goreecloud.com",
    "https://teams.goreecloud.com?token=fake",
    "https://teams.goreecloud.com/#fragment",
    "https://teams.goreecloud.com/",
    " https://teams.goreecloud.com",
    "https://teams.goreecloud.com\n"
  ]) {
    bad({TEAMS_SITE_ORIGIN:url},/origin|HTTPS/);
  }
});

test("production requires bounded numeric ports, safe host and absolute data paths",()=>{
  bad({NODE_ENV:"prodution"},/NODE_ENV/);
  bad({NODE_ENV:"Production"},/NODE_ENV/);
  for(const port of ["","0","-1","65536","NaN","3.2","0x12"," 3030 ","3030x"]) {
    bad({PORT:port},/PORT/);
  }
  for(const host of ["","host name","../../tmp","0.0.0.0; echo unsafe","[::1]"]) {
    bad({HOST:host},/HOST/);
  }
  bad({TEAMS_DB_PATH:"./data/test.sqlite"},/TEAMS_DB_PATH/);
  bad({TEAMS_DB_PATH:""},/TEAMS_DB_PATH/);
  bad({TEAMS_DB_PATH:"/data/\0file"},/TEAMS_DB_PATH/);
  bad({TEAMS_ATTACHMENT_DIRECTORY:"private/files"},/TEAMS_ATTACHMENT_DIRECTORY/);
});

test("explicit production Compose configuration is accepted with no stored authority proof",()=>{
  const actual=readLaunchConfiguration(syntheticProduction);
  assert.equal(actual.siteOrigin,"https://teams.goreecloud.com");
  assert.equal(actual.host,"0.0.0.0");
  assert.equal(actual.port,3030);
  assert.equal(actual.databaseFile,"/data/teams.sqlite");
  assert.equal(actual.attachmentDirectory,"/data/private-attachments");
  assert.equal(actual.bootstrapToken,syntheticProduction.TEAMS_BOOTSTRAP_TOKEN);
  assert.equal(Object.isFrozen(actual),true);
  assert.equal(readLaunchConfiguration({
    HOST:"::1",PORT:"0",TEAMS_SITE_ORIGIN:"http://127.0.0.1:5173",
    TEAMS_DB_PATH:"./temp/test.sqlite"
  }).port,0,"non-production loopback tests remain supported");
  assert.equal(readLaunchConfiguration({}).host,"127.0.0.1");
});

test("official entrypoint fails closed before creating SQLite and never leaks operator secret",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gct-startup-gate-"));
  try {
    const db=path.join(root,"nonexistent-data","never-create.sqlite");
    const entry=fileURLToPath(new URL("../src/index.mjs",import.meta.url));
    for(const origin of ["", "http://teams.goreecloud.com", "https://teams.yourdomain.example"]) {
      const output=spawnSync(process.execPath,[entry],{
        timeout:4000,encoding:"utf8",
        env:{...process.env,...syntheticProduction,
          NODE_ENV:"production",TEAMS_SITE_ORIGIN:origin,
          TEAMS_DB_PATH:db,HOST:"127.0.0.1",PORT:"3030"}
      });
      assert.equal(output.status,1,
        "invalid production origin must abort before listen");
      assert.match(output.stderr,/Teams startup configuration rejected:/);
      assert.equal(output.stdout.includes(syntheticProduction.TEAMS_BOOTSTRAP_TOKEN),false);
      assert.equal(output.stderr.includes(syntheticProduction.TEAMS_BOOTSTRAP_TOKEN),false);
      assert.equal(fs.existsSync(path.dirname(db)),false,
        "no database directory was created before failed launch");
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
