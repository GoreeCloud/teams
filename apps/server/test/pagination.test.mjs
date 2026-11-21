import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.mjs";
import { openDatabase } from "../src/db.mjs";

const call = (app, method, url, accessToken, payload) =>
  app.inject({ method, url, payload,
    headers: accessToken ? { authorization: "Bearer " + accessToken } : {} });

test("cursor history is complete, stable, bounded and isolated by channel and thread", async t => {
  const app = createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async () => app.close());
  const session = await call(app, "POST", "/api/auth/register", null, {
    username: "history_owner", displayName: "History Owner", password: "synthetic-history-test-password"
  });
  assert.equal(session.statusCode, 201, session.body);
  const auth = session.json().accessToken;
  const workspace = (await call(app, "GET", "/api/workspaces", auth)).json()[0];
  const channels = (await call(app, "GET", "/api/workspaces/"+workspace.id+"/channels", auth)).json();
  const general = channels.find(ch => ch.name === "general");
  const random = channels.find(ch => ch.name === "random");
  const all = [];
  for (let i = 0; i < 112; i++) {
    const r = await call(app, "POST", "/api/channels/"+general.id+"/messages", auth, {
      body: "History entry "+i
    });
    assert.equal(r.statusCode, 201, r.body);
    all.push(r.json());
  }
  const outsider = await call(app, "POST", "/api/channels/"+random.id+"/messages", auth,
    { body: "Foreign channel anchor" });
  assert.equal(outsider.statusCode, 201);
  const threadRoot = all[3];
  const threadReplies = [];
  for (let i = 0; i < 5; i++) {
    const response = await call(app, "POST", "/api/channels/"+general.id+"/messages", auth,
      { body: "Thread "+i, parentId: threadRoot.id });
    assert.equal(response.statusCode, 201);
    threadReplies.push(response.json());
  }
  const pages = [], seen = new Set();
  let before = null;
  for (const expectedLength of [50, 50, 12]) {
    const query = before ? "?before="+before : "";
    const response = await call(app, "GET", "/api/channels/"+general.id+"/messages"+query, auth);
    assert.equal(response.statusCode, 200, response.body);
    const items = response.json();
    assert.equal(items.length, expectedLength);
    for (const m of items) {
      assert.equal(m.channelId, general.id);
      assert.equal(m.parentId, null);
      assert.ok(!seen.has(m.id), "no overlapping pages");
      seen.add(m.id);
    }
    pages.push(items);
    before = items[0].id;
  }
  assert.equal(seen.size, 112);
  assert.deepEqual(new Set(all.map(m=>m.id)), seen);
  assert.deepEqual((await call(app, "GET", "/api/channels/"+general.id+"/messages?before="+before, auth)).json(), []);
  assert.equal((await call(app, "GET", "/api/channels/"+general.id+"/messages?limit=0", auth)).statusCode, 400);
  assert.equal((await call(app, "GET", "/api/channels/"+general.id+"/messages?limit=101", auth)).statusCode, 400);
  assert.equal((await call(app, "GET", "/api/channels/"+general.id+"/messages?limit=NaN", auth)).statusCode, 400);
  assert.equal((await call(app, "GET", "/api/channels/"+general.id+"/messages?before=bad", auth)).statusCode, 400);
  assert.equal((await call(app, "GET", "/api/channels/"+general.id+"/messages?before="+outsider.json().id, auth)).statusCode, 404);
  assert.equal((await call(app, "GET", "/api/channels/"+general.id+"/messages?before=00000000-0000-4000-8000-000000000000", auth)).statusCode, 404);

  const threadURL = "/api/channels/"+general.id+"/messages?parentId="+threadRoot.id;
  const firstThread = await call(app, "GET", threadURL+"&limit=3", auth);
  assert.equal(firstThread.statusCode, 200);
  assert.equal(firstThread.json().length, 3);
  assert.equal((await call(app, "GET", threadURL+"&before="+firstThread.json()[0].id, auth)).json().length, 2);
  assert.equal((await call(app, "GET", threadURL+"&before="+threadRoot.id, auth)).statusCode, 404,
    "root cannot be used as a reply cursor");
  assert.equal((await call(app, "GET", "/api/channels/"+general.id+"/messages?before="+threadReplies[0].id, auth)).statusCode, 404,
    "reply cannot be used as a root cursor");
});


test("history queries use a scoped composite index", () => {
  const db = openDatabase(":memory:");
  try {
    for (const parent of ["IS NULL", "= ?"]) {
      const statement = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM messages WHERE channel_id=? AND parent_id "
        + parent + " ORDER BY created_at DESC,id DESC LIMIT ?");
      const params = parent === "IS NULL" ? ["synthetic-channel", 50]
        : ["synthetic-channel", "synthetic-thread", 50];
      const plan = statement.all(...params);
      assert.ok(plan.some(row => row.detail.includes("messages_channel_parent_history")),
        "expected channel/thread pagination index: " + JSON.stringify(plan));
    }
  } finally {
    db.close();
  }
});
