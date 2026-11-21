import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.mjs";

const TEST_SETUP_TOKEN = "synthetic-first-owner-setup-token-for-unit-tests-0000";
const PASSWORD = "synthetic-first-owner-password-only-for-tests";
const ownerPayload = (bootstrapToken) => ({
  username:"fixture_owner",
  displayName:"Synthetic Owner",
  password:PASSWORD,
  ...(bootstrapToken === undefined ? {} : {bootstrapToken})
});
const register = (app,bootstrapToken,headers={})=>app.inject({
  method:"POST",url:"/api/auth/register",
  headers,payload:ownerPayload(bootstrapToken)
});

test("persisted server fails closed until first-owner setup token is configured and verified",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"teams-owner-gate-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const databaseFile=path.join(dir,"teams.sqlite");
  const unconfigured=createServer({databaseFile,bootstrapToken:null});
  try {
    const config=await unconfigured.inject({method:"GET",url:"/api/config"});
    assert.equal(config.statusCode,200);
    assert.equal(config.json().bootstrapAvailable,true);
    assert.equal(config.json().bootstrapTokenRequired,true);
    assert.ok(!JSON.stringify(config.json()).includes(TEST_SETUP_TOKEN));
    const rejected=await register(unconfigured,TEST_SETUP_TOKEN);
    assert.equal(rejected.statusCode,503);
    assert.deepEqual(rejected.json(),{error:"Owner setup token is not configured"});
  } finally { await unconfigured.close(); }

  const initialized=createServer({databaseFile,bootstrapToken:TEST_SETUP_TOKEN});
  try {
    const missing=await register(initialized);
    assert.equal(missing.statusCode,403);
    const incorrect=await register(initialized,"synthetic-wrong-owner-token-value-is-long-enough",
      {"x-forwarded-for":"198.51.100.22"});
    assert.equal(incorrect.statusCode,403);
    assert.equal((await initialized.inject({method:"GET",url:"/api/config"})).json().bootstrapAvailable,true);
    const admitted=await register(initialized,TEST_SETUP_TOKEN);
    assert.equal(admitted.statusCode,201,admitted.body);
    const data=admitted.json();
    assert.ok(data.accessToken);
    assert.equal(data.user.username,"fixture_owner");
    assert.ok(!admitted.body.includes(TEST_SETUP_TOKEN));
    const after=await initialized.inject({method:"GET",url:"/api/config"});
    assert.equal(after.json().bootstrapAvailable,false);
    const unauthorized=await initialized.inject({
      method:"POST",url:"/api/auth/register",
      payload:{...ownerPayload(TEST_SETUP_TOKEN),username:"another_owner"}
    });
    assert.equal(unauthorized.statusCode,403,
      "the initial setup token does not bypass invitation requirements");
  } finally { await initialized.close(); }
  const restarted=createServer({databaseFile,bootstrapToken:null});
  try {
    const login=await restarted.inject({method:"POST",url:"/api/auth/login",
      payload:{username:"fixture_owner",password:PASSWORD}});
    assert.equal(login.statusCode,200,login.body);
    const config=await restarted.inject({method:"GET",url:"/api/config"});
    assert.equal(config.json().bootstrapAvailable,false);
  } finally { await restarted.close(); }
});

test("short configuration tokens are never accepted, while memory-only test fixtures are explicit",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"teams-owner-bounds-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const invalid=createServer({
    databaseFile:path.join(dir,"state.sqlite"),
    bootstrapToken:"short"
  });
  try {
    const response=await register(invalid,"short");
    assert.equal(response.statusCode,503);
    assert.equal((await invalid.inject({method:"GET",url:"/api/config"})).json().bootstrapTokenRequired,true);
  } finally {await invalid.close();}
  const synthetic=createServer({allowUnsafeMemoryBootstrap:true,bootstrapToken:null});
  try {
    const config=await synthetic.inject({method:"GET",url:"/api/config"});
    assert.equal(config.json().bootstrapTokenRequired,false);
    assert.equal((await register(synthetic)).statusCode,201);
  } finally {await synthetic.close();}
});


test("unsafe first-owner fixture can never use persistent or web-serving mode", async t=>{
  assert.throws(()=>createServer({
    databaseFile:"/tmp/synthetic.sqlite",allowUnsafeMemoryBootstrap:true
  }),/Unsafe bootstrap fixture/);
  assert.throws(()=>createServer({
    serveWeb:true,allowUnsafeMemoryBootstrap:true
  }),/Unsafe bootstrap fixture/);
  const normal=createServer({bootstrapToken:null});
  t.after(async()=>normal.close());
  const config=await normal.inject({method:"GET",url:"/api/config"});
  assert.equal(config.json().bootstrapTokenRequired,true);
  assert.equal((await register(normal)).statusCode,503);
});
