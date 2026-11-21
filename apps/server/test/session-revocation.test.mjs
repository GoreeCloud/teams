import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import Database from "better-sqlite3";
import WebSocket from "ws";
import { createServer } from "../src/server.mjs";

const request = (app, method, url, token, payload) => app.inject({
  method, url, payload,
  headers: token ? { authorization: "Bearer " + token } : {}
});

test("revoked and expired sessions stop receiving WebSocket events without affecting independent sessions",
  { timeout: 10000 }, async t => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "teams-session-revoke-"));
    const databaseFile = path.join(folder, "test.sqlite");
    const app = createServer({ databaseFile, bootstrapToken: "synthetic-owner-setup-test-token-at-least-32-chars" });
    const sockets = [];
    t.after(async () => {
      for (const socket of sockets) socket.terminate();
      await app.close();
      fs.rmSync(folder, { recursive: true, force: true });
    });
    const initial = await request(app, "POST", "/api/auth/register", null, {
      username: "test_owner", displayName: "Test Owner",
      password: "synthetic-test-password-12345", bootstrapToken: "synthetic-owner-setup-test-token-at-least-32-chars"
    });
    assert.equal(initial.statusCode, 201, initial.body);
    const primary = initial.json().accessToken;
    const login = () => request(app, "POST", "/api/auth/login", null,
      { username: "test_owner", password: "synthetic-test-password-12345" });
    const secondLogin = await login();
    assert.equal(secondLogin.statusCode, 200, secondLogin.body);
    const secondary = secondLogin.json().accessToken;
    const thirdLogin = await login();
    assert.equal(thirdLogin.statusCode, 200, thirdLogin.body);
    const tertiary = thirdLogin.json().accessToken;
    const workspace = (await request(app, "GET", "/api/workspaces", tertiary)).json()[0];
    const channel = (await request(app, "GET",
      "/api/workspaces/" + workspace.id + "/channels", tertiary)).json()
      .find(item => item.name === "general");
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address();
    async function connect(token) {
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/api/events", {
        headers: { authorization: "Bearer " + token }
      });
      sockets.push(socket);
      const handshake = once(socket, "message");
      await once(socket, "open");
      assert.equal(JSON.parse((await handshake)[0].toString()).type, "connected");
      return socket;
    }
    const revokedSocket = await connect(primary);
    const expiredSocket = await connect(secondary);
    const healthySocket = await connect(tertiary);

    const revokedClose = once(revokedSocket, "close");
    assert.equal((await request(app, "POST", "/api/auth/logout", primary, {})).statusCode, 200);
    assert.equal((await revokedClose)[0], 1008);
    assert.equal((await request(app, "GET", "/api/me", primary)).statusCode, 401);
    assert.equal(healthySocket.readyState, WebSocket.OPEN);
    assert.equal(expiredSocket.readyState, WebSocket.OPEN);

    // Simulate a natural TTL cutoff in a synthetic file-backed database.
    // The production code must recheck the persisted session on fanout.
    const db = new Database(databaseFile);
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(secondary).digest("hex");
    assert.equal(db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?")
      .run(Date.now() - 1, hash).changes, 1);
    db.close();
    assert.equal((await request(app, "GET", "/api/me", secondary)).statusCode, 401);
    const expiredClose = once(expiredSocket, "close");
    const healthyEvent = once(healthySocket, "message");
    const sent = await request(app, "POST",
      "/api/channels/" + channel.id + "/messages", tertiary,
      { body: "Synthetic event after session expiry" });
    assert.equal(sent.statusCode, 201, sent.body);
    assert.equal((await expiredClose)[0], 1008);
    const received = JSON.parse((await healthyEvent)[0].toString());
    assert.equal(received.type, "message.created");
    assert.equal(received.message.body, "Synthetic event after session expiry");
    assert.equal(healthySocket.readyState, WebSocket.OPEN);
  });
