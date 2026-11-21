import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import Database from "better-sqlite3";
import WebSocket from "ws";
import { createServer } from "../src/server.mjs";
import { openDatabase } from "../src/db.mjs";

const call = (app, method, url, secret, payload) => app.inject({
  method, url, payload,
  headers: secret ? { authorization: "Bearer " + secret } : {}
});

test("user can list/revoke own sessions without revealing bearer hashes or affecting other accounts",
  { timeout: 10000 }, async t => {
    const app = createServer({allowUnsafeMemoryBootstrap:true});
    const sockets = [];
    t.after(async () => {
      for (const socket of sockets) socket.terminate();
      await app.close();
    });
    const first = await call(app, "POST", "/api/auth/register", null, {
      username:"sessions_owner", displayName:"Owner",
      password:"synthetic-password-for-sessions-123"
    });
    assert.equal(first.statusCode, 201, first.body);
    const primary = first.json().accessToken;
    const login = async () => {
      const result = await call(app, "POST", "/api/auth/login", null, {
        username:"sessions_owner", password:"synthetic-password-for-sessions-123"
      });
      assert.equal(result.statusCode, 200, result.body);
      return result.json().accessToken;
    };
    const secondary = await login(), tertiary = await login();
    const workspace = (await call(app, "GET", "/api/workspaces", primary)).json()[0];
    const invite = await call(app, "POST", "/api/workspaces/" + workspace.id + "/invites",primary,{});
    const memberRegister = await call(app, "POST", "/api/auth/register", null, {
      username:"sessions_member",displayName:"Member",
      password:"synthetic-password-for-sessions-123", invite: invite.json().invite
    });
    assert.equal(memberRegister.statusCode, 201);
    const memberSecret = memberRegister.json().accessToken;
    const listed = await call(app, "GET", "/api/auth/sessions",primary);
    assert.equal(listed.statusCode, 200,listed.body);
    const sessions = listed.json();
    assert.equal(sessions.length,3);
    assert.equal(sessions.filter(s=>s.current).length,1);
    for (const item of sessions) {
      assert.match(item.id,/^[0-9a-f-]{36}$/);
      assert.equal(typeof item.createdAt,"number");
      assert.equal(typeof item.expiresAt,"number");
      assert.equal(typeof item.current,"boolean");
      assert.deepEqual(Object.keys(item).sort(), ["createdAt","current","expiresAt","id"]);
    }
    assert.equal(JSON.stringify(sessions).includes(primary),false);
    assert.equal(JSON.stringify(sessions).includes(secondary),false);
    assert.equal(JSON.stringify(sessions).includes(tertiary),false);
    assert.equal((await call(app, "GET", "/api/auth/sessions",null)).statusCode,401);
    const memberSession = (await call(app, "GET", "/api/auth/sessions",memberSecret)).json()[0];
    const foreign = sessions.find(s=>!s.current);
    assert.equal((await call(app, "DELETE", "/api/auth/sessions/"+memberSession.id,primary)).statusCode,404);
    assert.equal((await call(app, "DELETE", "/api/auth/sessions/"+foreign.id,memberSecret)).statusCode,404);
    assert.equal((await call(app, "DELETE", "/api/auth/sessions/invalid",primary)).statusCode,400);
    assert.equal((await call(app, "DELETE", "/api/auth/sessions/00000000-0000-4000-8000-000000000000",primary)).statusCode,404);
    await app.listen({host:"127.0.0.1",port:0});
    const {port} = app.server.address();
    async function connect(token) {
      const socket = new WebSocket("ws://127.0.0.1:"+port+"/api/events",
        {headers:{authorization:"Bearer "+token}});
      sockets.push(socket);
      const connected = once(socket,"message");
      await once(socket,"open");
      assert.equal(JSON.parse((await connected)[0].toString()).type,"connected");
      return socket;
    }
    const activeSocket = await connect(primary);
    const secondarySocket = await connect(secondary);
    const tertiarySocket = await connect(tertiary);
    // Find the second session via the same credential it represents.
    const secondaryId = (await call(app,"GET","/api/auth/sessions",secondary))
      .json().find(s=>s.current).id;
    const secondaryClosed = once(secondarySocket,"close");
    const single = await call(app,"DELETE","/api/auth/sessions/"+secondaryId,primary);
    assert.deepEqual(single.json(),{ok:true,current:false});
    assert.equal((await secondaryClosed)[0],1008);
    assert.equal((await call(app,"GET","/api/me",secondary)).statusCode,401);
    assert.equal((await call(app,"DELETE","/api/auth/sessions/"+secondaryId,primary)).statusCode,404);
    assert.equal(activeSocket.readyState,WebSocket.OPEN);
    assert.equal(tertiarySocket.readyState,WebSocket.OPEN);
    const thirdClosed = once(tertiarySocket,"close");
    const bulk = await call(app,"POST","/api/auth/sessions/revoke-others",primary,{});
    assert.deepEqual(bulk.json(),{ok:true,revokedCount:1});
    assert.equal((await thirdClosed)[0],1008);
    assert.equal((await call(app,"GET","/api/me",tertiary)).statusCode,401);
    assert.equal((await call(app,"GET","/api/auth/sessions",primary)).json().length,1);
    assert.equal(activeSocket.readyState,WebSocket.OPEN);
    assert.equal((await call(app,"GET","/api/auth/sessions",memberSecret)).json().length,1);
    const currentId = (await call(app,"GET","/api/auth/sessions",primary)).json()[0].id;
    const selfClose = once(activeSocket,"close");
    const self = await call(app,"DELETE","/api/auth/sessions/"+currentId,primary);
    assert.equal(self.statusCode,200);
    assert.deepEqual(self.json(),{ok:true,current:true});
    assert.match(self.headers["set-cookie"],/Max-Age=0/);
    assert.equal((await selfClose)[0],1008);
    assert.equal((await call(app,"GET","/api/me",primary)).statusCode,401);
    assert.equal((await call(app,"GET","/api/me",memberSecret)).statusCode,200);
});

test("legacy sessions migrate to stable public IDs without inventing a creation timestamp", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"teams-session-migration-"));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const filename = path.join(dir,"previous.sqlite");
  const legacy = new Database(filename);
  legacy.exec("CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER);"+
              "INSERT INTO sessions VALUES('synthetic-legacy-digest','synthetic-user',9999999999999);");
  legacy.close();
  // The original synthetic schema is old, not public-readable. Harden its
  // file mode before exercising schema migration on the secured server.
  fs.chmodSync(filename,0o600);
  const upgraded = openDatabase(filename);
  const row = upgraded.prepare("SELECT id,created_at AS createdAt FROM sessions WHERE token_hash=?")
    .get("synthetic-legacy-digest");
  assert.match(row.id,/^[0-9a-f-]{36}$/);
  assert.equal(row.createdAt,null);
  assert.equal(upgraded.prepare("PRAGMA index_list(sessions)").all()
    .some(index=>index.name==="sessions_public_id" && index.unique===1),true);
  upgraded.close();
  const reopened = openDatabase(filename);
  assert.equal(reopened.prepare("SELECT id FROM sessions WHERE token_hash=?")
    .get("synthetic-legacy-digest").id,row.id);
  reopened.close();
});


test("cookie-based session revocation requires matching origin, unlike bearer auth", async t => {
  const app = createServer({ allowUnsafeMemoryBootstrap:true, siteOrigin: "https://teams.example.test" });
  t.after(async () => app.close());
  const first = await call(app, "POST", "/api/auth/register", null, {
    username:"cookie_session_owner", displayName:"Owner",
    password:"synthetic-cookie-session-password-123"
  });
  assert.equal(first.statusCode, 201);
  const cookie = first.headers["set-cookie"];
  assert.ok(cookie);
  const list = await app.inject({
    method:"GET",url:"/api/auth/sessions",headers:{cookie}
  });
  assert.equal(list.statusCode,200);
  const own = list.json().find(session => session.current);
  assert.ok(own);
  assert.equal((await app.inject({
    method:"DELETE",url:"/api/auth/sessions/"+own.id,headers:{cookie}
  })).statusCode,403);
  assert.equal((await app.inject({
    method:"DELETE",url:"/api/auth/sessions/"+own.id,
    headers:{cookie,origin:"https://evil.example.test"}
  })).statusCode,403);
  assert.equal((await app.inject({
    method:"GET",url:"/api/auth/sessions",headers:{cookie}
  })).statusCode,200);
  const revoked = await app.inject({
    method:"DELETE",url:"/api/auth/sessions/"+own.id,
    headers:{cookie,origin:"https://teams.example.test"}
  });
  assert.equal(revoked.statusCode,200,revoked.body);
  assert.equal(revoked.json().current,true);
  assert.equal((await app.inject({
    method:"GET",url:"/api/auth/sessions",headers:{cookie}
  })).statusCode,401);
});
