import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { once } from "node:events";
import { createServer } from "../src/server.mjs";

const post = (app, url, payload, token) => app.inject({
  method: "POST", url, payload, headers: token ? { authorization: "Bearer " + token } : {}
});
const get = (app, url, token) => app.inject({
  method: "GET", url, headers: token ? { authorization: "Bearer " + token } : {}
});

test("bootstrap, invitations, channels, private membership, author checks and scoped search", async t => {
  const app = createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async () => app.close());
  const invalid = await post(app, "/api/auth/register", { username: "x", password: "bad" });
  assert.equal(invalid.statusCode, 400);
  const ownerResponse = await post(app, "/api/auth/register", {
    username: "owner", displayName: "Owner", password: "example-password-12345"
  });
  assert.equal(ownerResponse.statusCode, 201, ownerResponse.body);
  const ownerToken = ownerResponse.json().accessToken;
  const ownerId = ownerResponse.json().user.id;
  assert.equal((await get(app, "/api/config")).json().bootstrapAvailable, false);
  assert.equal((await post(app, "/api/auth/register", {
    username: "other", displayName: "Other", password: "another-example-password"
  })).statusCode, 403);
  const workspace = (await get(app, "/api/workspaces", ownerToken)).json()[0];
  assert.equal(workspace.role, "owner");
  const invite = (await post(app, "/api/workspaces/" + workspace.id + "/invites", {}, ownerToken)).json().invite;
  const second = await post(app, "/api/auth/register", {
    username: "teammate", displayName: "Teammate", password: "another-example-password", invite
  });
  assert.equal(second.statusCode, 201, second.body);
  const teammateToken = second.json().accessToken;
  const teammateId = second.json().user.id;
  assert.equal((await post(app, "/api/auth/register", {
    username: "third", displayName: "Third", password: "another-example-password", invite
  })).statusCode, 403);
  assert.equal((await post(app, "/api/workspaces/" + workspace.id + "/channels",
    { name: "no-permission" }, teammateToken)).statusCode, 403);
  const privateChannelResponse = await post(app, "/api/workspaces/" + workspace.id + "/channels",
    { name: "private-room", isPrivate: true }, ownerToken);
  assert.equal(privateChannelResponse.statusCode, 201, privateChannelResponse.body);
  const privateChannel = privateChannelResponse.json();
  const channels = (await get(app, "/api/workspaces/" + workspace.id + "/channels", teammateToken)).json();
  assert.ok(!channels.some(c => c.id === privateChannel.id));
  assert.equal((await get(app, "/api/channels/" + privateChannel.id + "/messages", teammateToken)).statusCode, 404);
  const privateMsg = await post(app, "/api/channels/" + privateChannel.id + "/messages",
    { body: "Private channel keyword" }, ownerToken);
  assert.equal(privateMsg.statusCode, 201);
  assert.deepEqual((await get(app, "/api/workspaces/" + workspace.id + "/search?q=keyword", teammateToken)).json(), []);
  const add = await post(app, "/api/channels/" + privateChannel.id + "/members",
    { username: "teammate" }, ownerToken);
  assert.equal(add.statusCode, 200);
  assert.equal((await get(app, "/api/channels/" + privateChannel.id + "/messages", teammateToken)).json().length, 1);
  const general = (await get(app, "/api/workspaces/" + workspace.id + "/channels", ownerToken)).json()
    .find(c => c.name === "general");
  const message = await post(app, "/api/channels/" + general.id + "/messages",
    { body: "Hi, Team!" }, ownerToken);
  assert.equal(message.statusCode, 201, message.body);
  const id = message.json().id;
  const reply = await post(app, "/api/channels/" + general.id + "/messages",
    { body: "Reply", parentId: id }, teammateToken);
  assert.equal(reply.statusCode, 201, reply.body);
  assert.equal((await get(app, "/api/channels/" + general.id + "/messages?parentId=" + id, ownerToken)).json().length, 1);
  const updateByOther = await app.inject({ method:"PATCH", url:"/api/messages/"+id,
    payload:{body:"Overwritten"}, headers:{ authorization:"Bearer "+teammateToken }});
  assert.equal(updateByOther.statusCode, 403);
  const updateByOwner = await app.inject({ method:"PATCH", url:"/api/messages/"+id,
    payload:{body:"Updated safely"}, headers:{ authorization:"Bearer "+ownerToken }});
  assert.equal(updateByOwner.statusCode, 200);
  const reaction = await post(app, "/api/messages/" + id + "/reactions",
    { emoji: "👍" }, teammateToken);
  assert.equal(reaction.json().reactions[0].count, 1);
  assert.equal((await get(app, "/api/workspaces/" + workspace.id + "/search?q=Updated", teammateToken)).json().length, 1);
  assert.equal((await get(app, "/api/me", teammateToken)).json().user.id, teammateId);
  assert.equal((await get(app, "/api/me", "invalid")).statusCode, 401);
  assert.equal((await post(app, "/api/auth/logout", {}, ownerToken)).statusCode, 200);
  assert.equal((await get(app, "/api/me", ownerToken)).statusCode, 401);
  assert.ok(ownerId);
});

test("cookie-authenticated mutation requires an origin and WebSocket bearer is scoped", async t => {
  const app = createServer({allowUnsafeMemoryBootstrap:true});
  const initial = await post(app, "/api/auth/register",
    {username:"founder",displayName:"Founder",password:"founder-password-abc123"});
  const secret = initial.json().accessToken;
  const cookie = initial.headers["set-cookie"];
  const workspaces = (await get(app, "/api/workspaces", secret)).json();
  assert.equal((await app.inject({method:"POST",url:"/api/workspaces/"+workspaces[0].id+"/invites",
    payload:{}, headers:{cookie}})).statusCode, 403);
  await app.listen({port:0, host:"127.0.0.1"});
  const address = app.server.address();
  const ws = new WebSocket("ws://127.0.0.1:" + address.port + "/api/events",
    { headers:{ authorization:"Bearer "+secret } });
  t.after(async () => { ws.terminate(); await app.close(); });
  const [data] = await once(ws, "message");
  assert.equal(JSON.parse(String(data)).type, "connected");
});
