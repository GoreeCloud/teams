import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.mjs";

const request = (app, method, url, secret, payload) => app.inject({
  method, url, payload, headers: secret ? { authorization: "Bearer " + secret } : {}
});
const register = (app, username, invite) => request(app, "POST", "/api/auth/register", null, {
  username, displayName: username.toUpperCase(), password: "synthetic-example-password-123",
  ...(invite ? { invite } : {})
});
test("member directory is workspace scoped and admins alone can add private-channel members", async t => {
  const app = createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async () => app.close());
  const first = await register(app, "workspace_owner");
  assert.equal(first.statusCode, 201, first.body);
  const ownerToken = first.json().accessToken;
  const workspaceId = (await request(app, "GET", "/api/workspaces", ownerToken)).json()[0].id;
  const newMember = async username => {
    const issued = await request(app, "POST", "/api/workspaces/"+workspaceId+"/invites", ownerToken, {});
    assert.equal(issued.statusCode, 201);
    const r = await register(app, username, issued.json().invite);
    assert.equal(r.statusCode, 201, r.body);
    return r.json().accessToken;
  };
  const memberToken = await newMember("member_one");
  const outsiderToken = await newMember("member_two");
  const directory = await request(app, "GET", "/api/workspaces/"+workspaceId+"/members", memberToken);
  assert.equal(directory.statusCode, 200);
  assert.deepEqual(directory.json().map(m => m.username), ["member_one", "member_two", "workspace_owner"]);
  assert.deepEqual(directory.json().map(m => m.role), ["member", "member", "owner"]);
  assert.equal((await request(app, "GET", "/api/workspaces/"+workspaceId+"/members", null)).statusCode, 401);
  assert.equal((await request(app, "GET", "/api/workspaces/not-a-workspace/members", memberToken)).statusCode, 404);
  const privateRes = await request(app, "POST", "/api/workspaces/"+workspaceId+"/channels",
    ownerToken, { name: "restricted", isPrivate: true });
  assert.equal(privateRes.statusCode, 201);
  const channelId = privateRes.json().id;
  assert.equal((await request(app, "GET", "/api/channels/"+channelId+"/messages", memberToken)).statusCode, 404);
  assert.equal((await request(app, "GET", "/api/channels/"+channelId+"/messages", outsiderToken)).statusCode, 404);
  assert.equal((await request(app, "POST", "/api/channels/"+channelId+"/members",
    memberToken, { username: "member_two" })).statusCode, 404,
    "nonmembers cannot discover or mutate private channels");
  const add = await request(app, "POST", "/api/channels/"+channelId+"/members",
    ownerToken, { username: "member_one" });
  assert.equal(add.statusCode, 200);
  assert.equal((await request(app, "GET", "/api/channels/"+channelId+"/messages", memberToken)).statusCode, 200);
  assert.equal((await request(app, "GET", "/api/channels/"+channelId+"/messages", outsiderToken)).statusCode, 404);
  assert.equal((await request(app, "POST", "/api/channels/"+channelId+"/members",
    memberToken, { username: "member_two" })).statusCode, 403);
  assert.equal((await request(app, "POST", "/api/channels/"+channelId+"/members",
    ownerToken, { username: "nonexistent" })).statusCode, 404);
});
