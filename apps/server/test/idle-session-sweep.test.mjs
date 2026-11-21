import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import WebSocket from "ws";
import { createServer } from "../src/server.mjs";

const PASSWORD="synthetic-idle-session-password-only-for-tests";
const SETUP="synthetic-idle-session-bootstrap-token-for-tests-00000";
const hash = value => createHash("sha256").update(value).digest("hex");
const request=(app,method,url,secret,payload)=>app.inject({
  method,url,payload,
  headers:secret?{authorization:"Bearer "+secret}:{}
});

test("rejects unsafe session sweep intervals before opening application state",()=>{
  for (const value of [0,1,24,-10,3600001,"50",NaN,Infinity]) {
    assert.throws(
      ()=>createServer({allowUnsafeMemoryBootstrap:true,sessionSweepIntervalMs:value}),
      /Session expiry sweep interval/
    );
  }
});

test("idle expired or remotely revoked sockets close on their own without event fanout",{
  timeout:10000
},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gct-expire-idle-"));
  const databaseFile=path.join(root,"app.sqlite");
  const app=createServer({
    databaseFile,bootstrapToken:SETUP,sessionSweepIntervalMs:45
  });
  const sockets=[];
  t.after(async()=>{
    for(const ws of sockets)ws.terminate();
    await app.close();
    fs.rmSync(root,{recursive:true,force:true});
  });
  const owner=await request(app,"POST","/api/auth/register",null,{
    username:"sweep_owner",displayName:"Sweep Fixture",password:PASSWORD,
    bootstrapToken:SETUP
  });
  assert.equal(owner.statusCode,201,owner.body);
  const first=owner.json().accessToken;
  const login=async()=>{
    const result=await request(app,"POST","/api/auth/login",null,{
      username:"sweep_owner",password:PASSWORD
    });
    assert.equal(result.statusCode,200,result.body);
    return result.json().accessToken;
  };
  const second=await login();
  const healthy=await login();
  await app.listen({host:"127.0.0.1",port:0});
  const base="ws://127.0.0.1:"+app.server.address().port+"/api/events";
  async function connect(secret) {
    const ws=new WebSocket(base,{headers:{authorization:"Bearer "+secret}});
    sockets.push(ws);
    const handshake=once(ws,"message");
    await once(ws,"open");
    const firstMessage=JSON.parse((await handshake)[0].toString());
    assert.deepEqual(firstMessage,{type:"connected"});
    return ws;
  }
  const expiredSocket=await connect(first);
  const revokedSocket=await connect(second);
  const validSocket=await connect(healthy);
  const expiredClose=once(expiredSocket,"close");
  const revokedClose=once(revokedSocket,"close");
  const db=new Database(databaseFile);
  try {
    assert.equal(db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?")
      .run(Date.now()-100,hash(first)).changes,1);
    assert.equal(db.prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(hash(second)).changes,1);
  }finally {db.close();}
  // No messages or HTTP API events are sent after the DB changes. The
  // bounded unref'd sweep is solely responsible for closing these sockets.
  const [expired,revoked]=await Promise.all([expiredClose,revokedClose]);
  assert.equal(expired[0],1008);
  assert.equal(revoked[0],1008);
  assert.equal(expired[1].toString(),"Session expired");
  assert.equal(revoked[1].toString(),"Session expired");
  assert.equal(validSocket.readyState,WebSocket.OPEN);
  assert.equal((await request(app,"GET","/api/me",first)).statusCode,401);
  assert.equal((await request(app,"GET","/api/me",second)).statusCode,401);
  assert.equal((await request(app,"GET","/api/me",healthy)).statusCode,200);

  const workspace=(await request(app,"GET","/api/workspaces",healthy)).json()[0];
  const channel=(await request(app,"GET",
    "/api/workspaces/"+workspace.id+"/channels",healthy)).json()
    .find(row=>row.name==="general");
  const received=once(validSocket,"message");
  const sent=await request(app,"POST",
    "/api/channels/"+channel.id+"/messages",healthy,
    {body:"Synthetic healthy session remains authorized"});
  assert.equal(sent.statusCode,201,sent.body);
  assert.equal(JSON.parse((await received)[0].toString()).type,"message.created");
  assert.equal(validSocket.readyState,WebSocket.OPEN);
});
