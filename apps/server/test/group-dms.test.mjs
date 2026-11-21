import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { once } from "node:events";
import { createServer } from "../src/server.mjs";

const call = (app, method, url, token, payload) => app.inject({
  method, url, payload, headers: token ? { authorization: "Bearer " + token } : {}
});

async function bootstrap(app) {
  const res = await call(app, "POST", "/api/auth/register", null, {
    username: "group_owner", displayName: "Owner", password: "synthetic-group-test-password-12345"
  });
  assert.equal(res.statusCode, 201, res.body);
  const ownerToken = res.json().accessToken;
  const workspace = (await call(app, "GET", "/api/workspaces", ownerToken)).json()[0];
  const member = async (name) => {
    const invite = await call(app, "POST", "/api/workspaces/" + workspace.id + "/invites",
      ownerToken, { role: "member" });
    assert.equal(invite.statusCode, 201);
    const registration = await call(app, "POST", "/api/auth/register", null, {
      username: name, displayName: name.toUpperCase(),
      password: "synthetic-group-test-password-12345", invite: invite.json().invite
    });
    assert.equal(registration.statusCode, 201, registration.body);
    return registration.json().accessToken;
  };
  const bob = await member("group_bob");
  const carol = await member("group_carol");
  const dave = await member("group_dave");
  return { ownerToken, workspace, bob, carol, dave };
}

test("group conversations have immutable, workspace-scoped 3+ participant membership", async t => {
  const app = createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async () => app.close());
  const { ownerToken, workspace, bob, carol, dave } = await bootstrap(app);
  const base = "/api/workspaces/" + workspace.id;
  const invalid = [
    { title: "", usernames: ["group_bob", "group_carol"] },
    { title: "Newlines\nin title", usernames: ["group_bob", "group_carol"] },
    { title: "Group", usernames: ["group_bob"] },
    { title: "Group", usernames: ["group_bob", "GROUP_BOB"] },
    { title: "Group", usernames: ["group_bob", "group_owner"] },
    { title: "Group", usernames: [] },
  ];
  for (const payload of invalid) {
    const result = await call(app, "POST", base + "/group-dms", ownerToken, payload);
    assert.equal(result.statusCode, 400, JSON.stringify(payload) + ": " + result.body);
  }
  assert.equal((await call(app, "POST", base + "/group-dms", ownerToken,
    { title: "No outsiders", usernames: ["group_bob", "unknown_user"] })).statusCode, 404);
  assert.equal((await call(app, "POST", base + "/group-dms", null,
    { title: "Private", usernames: ["group_bob", "group_carol"] })).statusCode, 401);

  const created = await call(app, "POST", base + "/group-dms", ownerToken,
    { title: "Planning room", usernames: ["group_bob", "group_carol"] });
  assert.equal(created.statusCode, 201, created.body);
  const group = created.json();
  assert.equal(group.kind, "group_dm");
  assert.equal(group.name, "Planning room");
  assert.equal(group.memberCount, 3);
  assert.equal(group.isPrivate, 1);
  for (const participant of [ownerToken, bob, carol]) {
    const dms = (await call(app, "GET", base + "/dms", participant)).json();
    assert.equal(dms.filter(c => c.id === group.id).length, 1);
    assert.equal((await call(app, "GET", "/api/channels/" + group.id + "/messages",
      participant)).statusCode, 200);
  }
  assert.equal((await call(app, "GET", base + "/dms", dave)).json()
    .some(c => c.id === group.id), false);
  assert.equal((await call(app, "GET", base + "/channels", dave)).json()
    .some(c => c.id === group.id), false);
  assert.equal((await call(app, "GET", "/api/channels/" + group.id + "/messages",
    dave)).statusCode, 404);
  assert.equal((await call(app, "POST", "/api/channels/" + group.id + "/messages",
    dave, { body: "unauthorized" })).statusCode, 404);

  const posted = await call(app, "POST", "/api/channels/" + group.id + "/messages",
    bob, { body: "Confidential roadmap" });
  assert.equal(posted.statusCode, 201, posted.body);
  assert.equal((await call(app, "GET", "/api/channels/" + group.id + "/messages",
    carol)).json().length, 1);
  assert.equal((await call(app, "GET", base + "/search?q=Confidential", dave)).json().length, 0);
  assert.equal((await call(app, "GET", base + "/search?q=Confidential", carol)).json().length, 1);
  assert.equal((await call(app, "POST", "/api/channels/" + group.id + "/members",
    ownerToken, { username: "group_dave" })).statusCode, 403,
    "group membership is fixed and cannot be changed using private-channel API");
});

test("group conversation discovery events are delivered to participants only", async t => {
  const app = createServer({allowUnsafeMemoryBootstrap:true});
  const clients = [];
  t.after(async () => {
    for (const socket of clients) socket.terminate();
    await app.close();
  });
  const { ownerToken, workspace, bob, carol, dave } = await bootstrap(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address();
  const observations = [[], [], []];
  const connect = async (token, events) => {
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/api/events",
      { headers: { authorization: "Bearer " + token } });
    clients.push(socket);
    socket.on("message", data => {
      try { events.push(JSON.parse(data.toString())); } catch { /* ignore malformed wire data */ }
    });
    await once(socket, "open");
  };
  await Promise.all([connect(bob, observations[0]),
    connect(carol, observations[1]), connect(dave, observations[2])]);
  const group = await call(app, "POST",
    "/api/workspaces/" + workspace.id + "/group-dms", ownerToken,
    { title: "Launch planning", usernames: ["group_bob", "group_carol"] });
  assert.equal(group.statusCode, 201, group.body);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(observations[0].filter(e => e.type === "dm.created").length, 1);
  assert.equal(observations[1].filter(e => e.type === "dm.created").length, 1);
  assert.equal(observations[2].filter(e => e.type === "dm.created").length, 0);
  assert.equal(observations[0].find(e => e.type === "dm.created").conversation.kind, "group_dm");
  const sent = await call(app, "POST",
    "/api/channels/" + group.json().id + "/messages", ownerToken, { body: "Only for participants" });
  assert.equal(sent.statusCode, 201);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(observations[0].filter(e => e.type === "message.created").length, 1);
  assert.equal(observations[1].filter(e => e.type === "message.created").length, 1);
  assert.equal(observations[2].filter(e => e.type === "message.created").length, 0);
});
