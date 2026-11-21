import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import WebSocket from "ws";
import { once } from "node:events";
import { openDatabase } from "../src/db.mjs";
import assert from "node:assert/strict";
import { createServer } from "../src/server.mjs";

const send = (app, method, url, token, payload) => app.inject({
  method, url, payload, headers: token ? { authorization: "Bearer " + token } : {}
});
async function newUser(app, username, invite) {
  const res = await send(app, "POST", "/api/auth/register", null, {
    username, displayName: username, password: "test-password-secure-123", ...(invite ? { invite } : {})
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().accessToken;
}
test("direct messages are unique, consent-scoped to a workspace pair, and omitted from regular channels", async t => {
  const app = createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async () => app.close());
  const alice = await newUser(app, "alice");
  const workspace = (await send(app, "GET", "/api/workspaces", alice)).json()[0];
  const invite1 = (await send(app, "POST", "/api/workspaces/"+workspace.id+"/invites", alice, {})).json().invite;
  const bob = await newUser(app, "bob", invite1);
  const invite2 = (await send(app, "POST", "/api/workspaces/"+workspace.id+"/invites", alice, {})).json().invite;
  const carol = await newUser(app, "carol", invite2);
  const dmResponse = await send(app, "POST", "/api/workspaces/"+workspace.id+"/dms", alice, {username:"bob"});
  assert.equal(dmResponse.statusCode, 200, dmResponse.body);
  const dm = dmResponse.json();
  assert.equal(dm.kind, "dm");
  assert.equal(dm.peerName, "bob");
  const reverse = await send(app, "POST", "/api/workspaces/"+workspace.id+"/dms", bob, {username:"alice"});
  assert.equal(reverse.statusCode, 200, reverse.body);
  assert.equal(reverse.json().id, dm.id);
  assert.equal(reverse.json().peerName, "alice");
  assert.equal((await send(app, "GET", "/api/workspaces/"+workspace.id+"/dms", alice)).json().length, 1);
  assert.equal((await send(app, "GET", "/api/workspaces/"+workspace.id+"/dms", bob)).json().length, 1);
  assert.deepEqual((await send(app, "GET", "/api/workspaces/"+workspace.id+"/dms", carol)).json(), []);
  assert.equal((await send(app, "GET", "/api/workspaces/"+workspace.id+"/channels", alice)).json().some(c=>c.id===dm.id), false);
  const secret = await send(app, "POST", "/api/channels/"+dm.id+"/messages", alice, {body:"Top-secret meeting notes for Bob"});
  assert.equal(secret.statusCode, 201, secret.body);
  const reply = await send(app, "POST", "/api/channels/"+dm.id+"/messages", bob, {body:"Acknowledged"});
  assert.equal(reply.statusCode, 201, reply.body);
  assert.equal((await send(app, "GET", "/api/channels/"+dm.id+"/messages", bob)).json().length, 2);
  assert.equal((await send(app, "GET", "/api/channels/"+dm.id+"/messages", carol)).statusCode, 404);
  assert.equal((await send(app, "POST", "/api/channels/"+dm.id+"/messages", carol, {body:"intrusion"})).statusCode, 404);
  assert.equal((await send(app, "POST", "/api/channels/"+dm.id+"/members", alice, {username:"carol"})).statusCode, 403);
  assert.deepEqual((await send(app, "GET", "/api/workspaces/"+workspace.id+"/search?q=Top-secret", carol)).json(), []);
  assert.equal((await send(app, "GET", "/api/workspaces/"+workspace.id+"/search?q=Top-secret", bob)).json().length, 1);
  assert.equal((await send(app, "POST", "/api/workspaces/"+workspace.id+"/dms", alice, {username:"alice"})).statusCode, 400);
  assert.equal((await send(app, "POST", "/api/workspaces/"+workspace.id+"/dms", alice, {username:"nobody"})).statusCode, 404);
});


test("migrating an existing channel database adds the DM kind safely", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "teams-dm-migrate-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "teams.sqlite");
  const legacy = new Database(filename);
  legacy.exec(`CREATE TABLE channels (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
    is_private INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  ); INSERT INTO channels VALUES ('old','workspace','general',0,'2026-01-01T00:00:00Z');`);
  legacy.close();
  const migrated = openDatabase(filename);
  t.after(() => migrated.close());
  assert.equal(migrated.prepare("SELECT kind FROM channels WHERE id='old'").get().kind, "channel");
  assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='direct_conversations'").get());
});

test("direct-message WebSocket events never reach an uninvolved workspace member", async t => {
  const app = createServer({allowUnsafeMemoryBootstrap:true});
  await app.listen({host:"127.0.0.1",port:0});
  const clients = [];
  t.after(async () => {
    for (const socket of clients) socket.terminate();
    await app.close();
  });
  const alice = await newUser(app, "a_l_i_c_e");
  const workspace = (await send(app, "GET", "/api/workspaces", alice)).json()[0];
  async function invited(name) {
    const inv = (await send(app, "POST", "/api/workspaces/"+workspace.id+"/invites",alice,{})).json().invite;
    return newUser(app,name,inv);
  }
  const bob = await invited("b_o_b");
  const carol = await invited("c_a_r_o_l");
  const observed = [[], [], []];
  async function subscribe(secret, events) {
    const {port} = app.server.address();
    const ws = new WebSocket("ws://127.0.0.1:"+port+"/api/events",
      {headers:{authorization:"Bearer "+secret}});
    clients.push(ws);
    ws.on("message", raw => {
      try { events.push(JSON.parse(raw.toString())); } catch { /* invalid wire payload */ }
    });
    await once(ws, "open");
  }
  await Promise.all([subscribe(alice,observed[0]),subscribe(bob,observed[1]),subscribe(carol,observed[2])]);
  const dm = (await send(app, "POST", "/api/workspaces/"+workspace.id+"/dms",alice,{username:"b_o_b"})).json();
  const result = await send(app, "POST", "/api/channels/"+dm.id+"/messages", alice, {body:"confidential for Bob"});
  assert.equal(result.statusCode, 201, result.body);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(observed[0].filter(e=>e.type==="message.created").length, 1);
  assert.equal(observed[1].filter(e=>e.type==="message.created").length, 1);
  assert.equal(observed[2].filter(e=>e.type==="message.created").length, 0);
  assert.equal(observed[0].filter(e=>e.type==="dm.created").length, 1);
  assert.equal(observed[1].filter(e=>e.type==="dm.created").length, 1);
  assert.equal(observed[2].filter(e=>e.type==="dm.created").length, 0);
  assert.equal(observed[0].find(e=>e.type==="dm.created").conversation.peerName,"b_o_b");
  assert.equal(observed[1].find(e=>e.type==="dm.created").conversation.peerName,"a_l_i_c_e");
});
