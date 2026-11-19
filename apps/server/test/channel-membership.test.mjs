import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { once } from "node:events";
import { createServer } from "../src/server.mjs";

const call = (app, method, url, token, payload) => app.inject({
  method, url, payload,
  headers: token ? { authorization: "Bearer " + token } : {}
});
async function fixture(app) {
  const primary = await call(app, "POST", "/api/auth/register", null, {
    username: "acl_owner", displayName: "Owner", password: "synthetic-acl-owner-password-123"
  });
  assert.equal(primary.statusCode, 201, primary.body);
  const owner = primary.json().accessToken;
  const ownerId = primary.json().user.id;
  const workspace = (await call(app, "GET", "/api/workspaces", owner)).json()[0];
  const member = async (name, role = "member") => {
    const invite = await call(app, "POST", "/api/workspaces/" + workspace.id + "/invites",
      owner, { role });
    assert.equal(invite.statusCode, 201);
    const created = await call(app, "POST", "/api/auth/register", null, {
      username: name, displayName: name,
      password: "synthetic-acl-member-password-123",
      invite: invite.json().invite
    });
    assert.equal(created.statusCode, 201, created.body);
    return { token: created.json().accessToken, id: created.json().user.id };
  };
  const admin = await member("acl_admin", "admin");
  const bob = await member("acl_bob");
  const carol = await member("acl_carol");
  const ch = await call(app, "POST", "/api/workspaces/" + workspace.id + "/channels",
    owner, { name: "private-ops", isPrivate: true });
  assert.equal(ch.statusCode, 201, ch.body);
  return { owner, ownerId, workspace, admin, bob, carol, ch: ch.json() };
}

test("only authorized private-channel managers can list and revoke members", async t => {
  const app = createServer();
  t.after(async () => app.close());
  const {owner, ownerId, workspace, admin, bob, carol, ch} = await fixture(app);
  const base = "/api/channels/" + ch.id;
  const list = token => call(app, "GET", base + "/members", token);
  const add = (token, name) => call(app, "POST", base + "/members", token, {username:name});
  const del = (token, memberId) => call(app, "DELETE", base + "/members/" + memberId, token);

  assert.equal((await list(null)).statusCode, 401);
  assert.equal((await list(carol.token)).statusCode, 404, "uninvolved workspace members cannot list private membership");
  assert.equal((await add(owner, "acl_bob")).json().added, true);
  assert.equal((await add(owner, "acl_admin")).json().added, true);
  assert.equal((await add(owner, "acl_admin")).json().added, false, "duplicate invites must be idempotent");
  assert.deepEqual((await list(bob.token)).json().map(m => m.username),
    ["acl_admin", "acl_bob", "acl_owner"]);
  assert.equal((await del(bob.token, ownerId)).statusCode, 403);
  assert.equal((await del(admin.token, ownerId)).statusCode, 403, "admins cannot remove workspace owner");
  assert.equal((await del(owner, ownerId)).statusCode, 409, "manager cannot remove self");
  assert.equal((await del(admin.token, admin.id)).statusCode, 409);
  assert.equal((await del(admin.token, "invalid")).statusCode, 400);
  assert.equal((await del(admin.token, carol.id)).statusCode, 404);
  assert.equal((await del(carol.token, bob.id)).statusCode, 404, "nonmembers cannot discover channels through removal");

  const confidential = await call(app, "POST", base + "/messages",
    owner, { body:"Private member-only changelog" });
  assert.equal(confidential.statusCode, 201);
  assert.equal((await call(app, "GET", base + "/messages", bob.token)).statusCode, 200);
  assert.equal((await del(admin.token, bob.id)).statusCode, 200);
  assert.equal((await list(bob.token)).statusCode, 404);
  assert.equal((await call(app, "GET", base + "/messages", bob.token)).statusCode, 404);
  assert.equal((await call(app, "GET",
    "/api/workspaces/" + workspace.id + "/search?q=changelog", bob.token)).json().length, 0);
  assert.equal((await call(app, "GET",
    "/api/workspaces/" + workspace.id + "/search?q=changelog", admin.token)).json().length, 1);

  const general = (await call(app, "GET",
    "/api/workspaces/" + workspace.id + "/channels", owner)).json().find(c => c.name === "general");
  assert.equal((await call(app, "GET", "/api/channels/" + general.id + "/members", owner)).statusCode, 400);
  assert.equal((await call(app, "DELETE",
    "/api/channels/" + general.id + "/members/" + bob.id, owner)).statusCode, 400);
  const dm = await call(app, "POST", "/api/workspaces/" + workspace.id + "/dms",
    owner, { username:"acl_bob" });
  assert.equal(dm.statusCode, 200, dm.body);
  assert.equal((await call(app, "GET", "/api/channels/" + dm.json().id + "/members", owner)).statusCode, 403);
  assert.equal((await call(app, "DELETE",
    "/api/channels/" + dm.json().id + "/members/" + bob.id, owner)).statusCode, 403);
});

test("channel.added and channel.removed events are scoped; removed sockets receive no private messages", async t => {
  const app = createServer();
  const sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    await app.close();
  });
  const {owner, workspace, admin, bob, carol, ch} = await fixture(app);
  const events = {bob:[],admin:[],carol:[]};
  await app.listen({host:"127.0.0.1",port:0});
  const {port} = app.server.address();
  async function connect(token, bucket) {
    const socket = new WebSocket("ws://127.0.0.1:"+port+"/api/events", {
      headers:{authorization:"Bearer "+token}
    });
    sockets.push(socket);
    socket.on("message", bytes => {
      try {bucket.push(JSON.parse(bytes.toString()));} catch { /* malformed optional event */ }
    });
    await once(socket, "open");
  }
  await Promise.all([
    connect(bob.token, events.bob),
    connect(admin.token, events.admin),
    connect(carol.token, events.carol)
  ]);
  const base = "/api/channels/" + ch.id;
  const join = await call(app, "POST", base + "/members", owner, {username:"acl_bob"});
  assert.equal(join.statusCode, 200, join.body);
  const joinAdmin = await call(app, "POST", base + "/members", owner, {username:"acl_admin"});
  assert.equal(joinAdmin.statusCode, 200);
  await new Promise(resolve=>setTimeout(resolve, 100));
  const discovered = events.bob.filter(item => item.type === "channel.added");
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].channelId, ch.id);
  assert.equal(events.carol.some(item=>item.channelId===ch.id), false);
  const removed = await call(app, "DELETE", base + "/members/" + bob.id, admin.token);
  assert.equal(removed.statusCode, 200, removed.body);
  const sent = await call(app, "POST", base + "/messages", owner, {
    body: "Private message after membership revoked"
  });
  assert.equal(sent.statusCode, 201);
  await new Promise(resolve=>setTimeout(resolve, 100));
  assert.equal(events.bob.filter(item=>item.type==="channel.removed"&&item.channelId===ch.id).length, 1);
  assert.equal(events.bob.some(item=>item.type==="message.created"&&item.channelId===ch.id), false);
  assert.equal(events.admin.filter(item=>item.type==="message.created"&&item.channelId===ch.id).length, 1);
  assert.equal(events.carol.some(item=>item.channelId===ch.id), false);
});
