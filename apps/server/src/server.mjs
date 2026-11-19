import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import argon2 from "argon2";
import { WebSocketServer } from "ws";
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db.mjs";

const MAX_BODY = 4000;
const USERNAME = /^[a-zA-Z0-9_.-]{3,32}$/;
const CHANNEL = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const now = () => new Date().toISOString();
const token = () => randomBytes(32).toString("base64url");
const hashToken = value => createHash("sha256").update(value).digest("hex");
const error = (reply, status, message) => reply.code(status).send({ error: message });
const validText = (s, max) => typeof s === "string" && s.trim().length > 0 && s.trim().length <= max;
const cookieValue = (header, name) => {
  const raw = String(header || "").split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return raw ? raw.slice(name.length + 1) : "";
};

export function createServer({ databaseFile = ":memory:", siteOrigin = "", serveWeb = false } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024, trustProxy: false });
  const db = openDatabase(databaseFile);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const sockets = new Map();
  const loginAttempts = new Map();
  const getUser = id => db.prepare("SELECT id, username, display_name AS displayName FROM users WHERE id=?").get(id);
  const workspaceRole = (userId, workspaceId) => db.prepare(
    "SELECT role FROM memberships WHERE user_id=? AND workspace_id=?"
  ).get(userId, workspaceId)?.role;
  const channelFor = (userId, channelId) => {
    const ch = db.prepare("SELECT id, workspace_id AS workspaceId, name, is_private AS isPrivate, kind FROM channels WHERE id=?").get(channelId);
    if (!ch || !workspaceRole(userId, ch.workspaceId)) return null;
    if (ch.isPrivate && !db.prepare("SELECT 1 FROM channel_members WHERE channel_id=? AND user_id=?").get(channelId, userId)) return null;
    return ch;
  };
  const sessionFromRequest = req => {
    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const value = bearer || cookieValue(req.headers.cookie, "gc_teams_session");
    if (!value || !/^[a-zA-Z0-9_-]{40,50}$/.test(value)) return null;
    const digest = hashToken(value);
    const row = db.prepare("SELECT user_id AS userId FROM sessions WHERE token_hash=? AND expires_at>?").get(digest, Date.now());
    return row ? { ...getUser(row.userId), bearer: !!bearer, sessionToken: value, sessionHash: digest } : null;
  };
  const ownOrigin = req => {
    const origin = req.headers.origin;
    if (!origin) return false;
    if (siteOrigin) return origin === siteOrigin;
    try {
      const parsed = new URL(origin);
      return parsed.host === req.headers.host && (parsed.protocol === "http:" || parsed.protocol === "https:");
    } catch { return false; }
  };
  const requireUser = async (req, reply) => {
    const user = sessionFromRequest(req);
    if (!user) return error(reply, 401, "Authentication required");
    // An authenticated cookie cannot mutate without same-origin proof. Native clients use Bearer.
    if (!user.bearer && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !ownOrigin(req)) {
      return error(reply, 403, "Origin check failed");
    }
    req.actor = user;
  };
  const requireWorkspace = (req, reply) => {
    const role = workspaceRole(req.actor.id, req.params.workspaceId);
    if (!role) { error(reply, 404, "Workspace not found"); return null; }
    return role;
  };
  const requireChannel = (req, reply, id) => {
    const channel = channelFor(req.actor.id, id);
    if (!channel) { error(reply, 404, "Channel not found"); return null; }
    return channel;
  };
  const issueSession = (reply, userId) => {
    const secret = token();
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)")
      .run(hashToken(secret), userId, Date.now() + 30 * 86400_000);
    reply.header("set-cookie",
      "gc_teams_session=" + secret + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000" +
      (process.env.NODE_ENV === "production" ? "; Secure" : ""));
    return secret;
  };
  const publicMessage = m => {
    const reactions = db.prepare(
      "SELECT emoji, count(*) AS count FROM reactions WHERE message_id=? GROUP BY emoji ORDER BY emoji"
    ).all(m.id);
    return { id: m.id, channelId: m.channel_id, authorId: m.author_id,
      author: getUser(m.author_id)?.displayName || "Unknown", body: m.deleted_at ? "" : m.body,
      parentId: m.parent_id, createdAt: m.created_at, editedAt: m.edited_at,
      deletedAt: m.deleted_at, reactions };
  };
  const messageById = id => db.prepare("SELECT * FROM messages WHERE id=?").get(id);
  // Active WebSocket transport is not proof that a previously authenticated
  // session remains authorized. Recheck revocation/expiry before fanout.
  const liveSocket = (socket, session) => {
    if (socket.readyState !== 1) return false;
    if (db.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?")
      .get(session.sessionHash, Date.now())) return true;
    sockets.delete(socket);
    socket.close(1008, "Session expired");
    return false;
  };
  const broadcast = (channelId, event) => {
    const data = JSON.stringify(event);
    for (const [socket, session] of sockets) {
      if (liveSocket(socket, session) && channelFor(session.userId, channelId)) socket.send(data);
    }
  };
  const broadcastToUser = (recipientId, event) => {
    const data = JSON.stringify(event);
    for (const [socket, session] of sockets) {
      if (liveSocket(socket, session) && session.userId === recipientId) socket.send(data);
    }
  };

  app.addHook("onRequest", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    reply.header("Cache-Control", "no-store");
  });
  app.get("/api/health", async () => ({ status: "ok", product: "GoreeCloud Teams" }));
  app.get("/api/config", async () => ({
    bootstrapAvailable: db.prepare("SELECT count(*) AS total FROM users").get().total === 0,
    title: "GoreeCloud Teams"
  }));
  app.post("/api/auth/register", async (req, reply) => {
    const b = req.body || {};
    if (!USERNAME.test(b.username || "") || !validText(b.displayName, 80) ||
        typeof b.password !== "string" || b.password.length < 12 || b.password.length > 256) {
      return error(reply, 400, "Valid username, display name and password (12–256 characters) required");
    }
    const count = db.prepare("SELECT count(*) AS total FROM users").get().total;
    const invite = count > 0 && typeof b.invite === "string"
      ? db.prepare("SELECT * FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?")
          .get(hashToken(b.invite), Date.now()) : null;
    if (count > 0 && !invite) return error(reply, 403, "Registration requires an invitation");
    const id = randomUUID(), created = now();
    const digest = await argon2.hash(b.password, { type: argon2.argon2id });
    try {
      db.transaction(() => {
        if (db.prepare("SELECT 1 FROM users WHERE username=?").get(b.username)) throw new Error("USERNAME_EXISTS");
        if (count === 0) {
          if (db.prepare("SELECT count(*) AS total FROM users").get().total !== 0) throw new Error("RACE");
        } else if (db.prepare("UPDATE invites SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?")
          .run(Date.now(), hashToken(b.invite), Date.now()).changes !== 1) throw new Error("INVITE_USED");
        db.prepare("INSERT INTO users VALUES(?,?,?,?,?)")
          .run(id, b.username.trim(), b.displayName.trim(), digest, created);
        if (count === 0) {
          const workspaceId = randomUUID();
          db.prepare("INSERT INTO workspaces VALUES(?,?,?,?)").run(workspaceId, "GoreeCloud Teams", id, created);
          db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(workspaceId, id, "owner");
          for (const name of ["general", "projects", "random"]) {
            db.prepare("INSERT INTO channels(id,workspace_id,name,is_private,created_at) VALUES(?,?,?,?,?)").run(randomUUID(), workspaceId, name, 0, created);
          }
        } else {
          db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(invite.workspace_id, id, invite.role);
        }
      })();
    } catch (e) {
      return error(reply, e.message === "USERNAME_EXISTS" ? 409 : 409, "Username or invitation no longer available");
    }
    const accessToken = issueSession(reply, id);
    return reply.code(201).send({ user: getUser(id), accessToken });
  });
  app.post("/api/auth/login", async (req, reply) => {
    const b = req.body || {};
    const ip = req.ip || "unknown", state = loginAttempts.get(ip) || { n: 0, since: Date.now() };
    if (Date.now() - state.since > 15 * 60_000) { state.n = 0; state.since = Date.now(); }
    if (state.n >= 10) return error(reply, 429, "Too many attempts. Try again later.");
    if (typeof b.username !== "string" || typeof b.password !== "string") return error(reply, 400, "Credentials required");
    const user = db.prepare("SELECT * FROM users WHERE username=?").get(b.username);
    let matches = false;
    if (user) { try { matches = await argon2.verify(user.password_hash, b.password); } catch { matches = false; } }
    if (!matches) { state.n++; loginAttempts.set(ip, state); return error(reply, 401, "Invalid credentials"); }
    loginAttempts.delete(ip);
    const accessToken = issueSession(reply, user.id);
    return { user: getUser(user.id), accessToken };
  });
  app.post("/api/auth/logout", { preHandler: requireUser }, async (req, reply) => {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(req.actor.sessionHash);
    for (const [socket, session] of sockets) {
      if (session.sessionHash === req.actor.sessionHash) {
        sockets.delete(socket);
        socket.close(1008, "Session revoked");
      }
    }
    reply.header("set-cookie", "gc_teams_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    return { ok: true };
  });
  app.get("/api/me", { preHandler: requireUser }, async req => ({ user: getUser(req.actor.id) }));
  app.get("/api/workspaces", { preHandler: requireUser }, async req =>
    db.prepare("SELECT w.id,w.name,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.name")
      .all(req.actor.id));
  app.get("/api/workspaces/:workspaceId/members", { preHandler: requireUser }, async (req, reply) => {
    if (!requireWorkspace(req, reply)) return;
    return db.prepare(`
      SELECT u.id, u.username, u.display_name AS displayName, m.role
      FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=?
      ORDER BY u.display_name COLLATE NOCASE, u.username COLLATE NOCASE
      LIMIT 500
    `).all(req.params.workspaceId);
  });
  app.get("/api/workspaces/:workspaceId/channels", { preHandler: requireUser }, async (req, reply) => {
    if (!requireWorkspace(req, reply)) return;
    return db.prepare(`
      SELECT c.id,c.name,c.workspace_id AS workspaceId,c.is_private AS isPrivate
      FROM channels c LEFT JOIN channel_members cm ON cm.channel_id=c.id AND cm.user_id=?
      WHERE c.workspace_id=? AND c.kind='channel' AND (c.is_private=0 OR cm.user_id IS NOT NULL)
      ORDER BY c.name`).all(req.actor.id, req.params.workspaceId);
  });
  app.post("/api/workspaces/:workspaceId/channels", { preHandler: requireUser }, async (req, reply) => {
    const role = requireWorkspace(req, reply);
    if (!role) return;
    if (role === "member") return error(reply, 403, "Admin role required");
    const name = String(req.body?.name || "").toLowerCase().trim();
    if (!CHANNEL.test(name)) return error(reply, 400, "Invalid channel name");
    const id = randomUUID(), privateFlag = req.body?.isPrivate === true ? 1 : 0;
    try {
      db.transaction(() => {
        db.prepare("INSERT INTO channels(id,workspace_id,name,is_private,created_at) VALUES(?,?,?,?,?)").run(id, req.params.workspaceId, name, privateFlag, now());
        if (privateFlag) db.prepare("INSERT INTO channel_members VALUES(?,?)").run(id, req.actor.id);
      })();
    } catch { return error(reply, 409, "Channel name already exists"); }
    return reply.code(201).send({ id, name, workspaceId: req.params.workspaceId, isPrivate: privateFlag });
  });
  // One-to-one direct conversations reuse the same message/thread/reaction pipeline
  // but remain private and cannot be converted into public workspace channels.
  const directConversation = (workspaceId, channelId, actorId) => {
    const dc = db.prepare("SELECT member_a AS memberA, member_b AS memberB FROM direct_conversations WHERE channel_id=? AND workspace_id=?").get(channelId, workspaceId);
    if (!dc || (dc.memberA !== actorId && dc.memberB !== actorId)) return null;
    const peer = getUser(dc.memberA === actorId ? dc.memberB : dc.memberA);
    return { id: channelId, workspaceId, name: peer.displayName, peerId: peer.id,
      peerName: peer.displayName, isPrivate: 1, kind: "dm" };
  };
  const groupConversation = (workspaceId, channelId, actorId) => {
    if (!channelFor(actorId, channelId)) return null;
    const conversation = db.prepare(
      "SELECT title FROM group_conversations WHERE channel_id=? AND workspace_id=?"
    ).get(channelId, workspaceId);
    if (!conversation) return null;
    const memberCount = db.prepare(
      "SELECT count(*) AS count FROM channel_members WHERE channel_id=?"
    ).get(channelId).count;
    return { id: channelId, workspaceId, name: conversation.title, isPrivate: 1,
      kind: "group_dm", memberCount };
  };
  app.get("/api/workspaces/:workspaceId/dms", { preHandler: requireUser }, async (req, reply) => {
    if (!requireWorkspace(req, reply)) return;
    const rows = db.prepare(`
      SELECT channel_id AS channelId FROM direct_conversations
      WHERE workspace_id=? AND (member_a=? OR member_b=?)
      ORDER BY channel_id
    `).all(req.params.workspaceId, req.actor.id, req.actor.id);
    const groups = db.prepare(`
      SELECT g.channel_id AS channelId FROM group_conversations g
      JOIN channel_members cm ON cm.channel_id=g.channel_id
      WHERE g.workspace_id=? AND cm.user_id=?
      ORDER BY g.created_at DESC, g.channel_id DESC
    `).all(req.params.workspaceId, req.actor.id);
    return [
      ...groups.map(row => groupConversation(req.params.workspaceId, row.channelId, req.actor.id)),
      ...rows.map(row => directConversation(req.params.workspaceId, row.channelId, req.actor.id))
    ];
  });
  app.post("/api/workspaces/:workspaceId/dms", { preHandler: requireUser }, async (req, reply) => {
    if (!requireWorkspace(req, reply)) return;
    const username = req.body?.username;
    if (typeof username !== "string" || !USERNAME.test(username)) return error(reply, 400, "Valid teammate username required");
    const peer = db.prepare("SELECT id FROM users WHERE username=?").get(username);
    if (!peer || !workspaceRole(peer.id, req.params.workspaceId)) return error(reply, 404, "Workspace teammate not found");
    if (peer.id === req.actor.id) return error(reply, 400, "Cannot direct-message yourself");
    const [memberA, memberB] = [peer.id, req.actor.id].sort();
    let channelId;
    try {
      channelId = db.transaction(() => {
        const existing = db.prepare(`
          SELECT channel_id AS channelId FROM direct_conversations
          WHERE workspace_id=? AND member_a=? AND member_b=?
        `).get(req.params.workspaceId, memberA, memberB);
        if (existing) return existing.channelId;
        const id = randomUUID();
        db.prepare("INSERT INTO channels(id,workspace_id,name,is_private,created_at,kind) VALUES(?,?,?,?,?,?)")
          .run(id, req.params.workspaceId, "dm-" + id, 1, now(), "dm");
        db.prepare("INSERT INTO direct_conversations VALUES(?,?,?,?)")
          .run(id, req.params.workspaceId, memberA, memberB);
        db.prepare("INSERT INTO channel_members VALUES(?,?)").run(id, memberA);
        db.prepare("INSERT INTO channel_members VALUES(?,?)").run(id, memberB);
        return id;
      })();
    } catch {
      // Unique pair index guards concurrent chat creation as well as duplicate requests.
      const existing = db.prepare(`
        SELECT channel_id AS channelId FROM direct_conversations
        WHERE workspace_id=? AND member_a=? AND member_b=?
      `).get(req.params.workspaceId, memberA, memberB);
      if (!existing) return error(reply, 409, "Conversation could not be created");
      channelId = existing.channelId;
    }
    for (const participant of [memberA, memberB]) {
      broadcastToUser(participant, {
        type: "dm.created",
        workspaceId: req.params.workspaceId,
        conversation: directConversation(req.params.workspaceId, channelId, participant)
      });
    }
    return directConversation(req.params.workspaceId, channelId, req.actor.id);
  });
  app.post("/api/workspaces/:workspaceId/group-dms", { preHandler: requireUser }, async (req, reply) => {
    if (!requireWorkspace(req, reply)) return;
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title || title.length > 80 || /[\x00-\x1f\x7f]/.test(title)) {
      return error(reply, 400, "Group title must contain 1–80 printable characters");
    }
    const requested = req.body?.usernames;
    // At least two teammates plus the creator: one-to-one uses /dms.
    if (!Array.isArray(requested) || requested.length < 2 || requested.length > 29 ||
        requested.some(name => typeof name !== "string" || !USERNAME.test(name))) {
      return error(reply, 400, "Choose 2–29 workspace teammates");
    }
    const unique = requested.map(name => name.toLowerCase());
    if (new Set(unique).size !== unique.length ||
        unique.includes(req.actor.username.toLowerCase())) {
      return error(reply, 400, "Group participants must be distinct teammates");
    }
    const participants = [req.actor.id];
    for (const username of requested) {
      const person = db.prepare("SELECT id FROM users WHERE username=?").get(username);
      if (!person || !workspaceRole(person.id, req.params.workspaceId)) {
        return error(reply, 404, "Workspace teammate not found");
      }
      participants.push(person.id);
    }
    const id = randomUUID();
    db.transaction(() => {
      db.prepare("INSERT INTO channels(id,workspace_id,name,is_private,created_at,kind) VALUES(?,?,?,?,?,?)")
        .run(id, req.params.workspaceId, "group-" + id, 1, now(), "dm");
      db.prepare("INSERT INTO group_conversations VALUES(?,?,?,?,?)")
        .run(id, req.params.workspaceId, title, req.actor.id, now());
      const add = db.prepare("INSERT INTO channel_members VALUES(?,?)");
      for (const memberId of participants) add.run(id, memberId);
    })();
    for (const memberId of participants) {
      broadcastToUser(memberId, {
        type: "dm.created",
        workspaceId: req.params.workspaceId,
        conversation: groupConversation(req.params.workspaceId, id, memberId)
      });
    }
    return reply.code(201).send(groupConversation(req.params.workspaceId, id, req.actor.id));
  });
  app.post("/api/channels/:channelId/members", { preHandler: requireUser }, async (req, reply) => {
    const ch = requireChannel(req, reply, req.params.channelId);
    if (!ch) return;
    if (ch.kind === "dm") return error(reply, 403, "Direct message membership is fixed");
    const role = workspaceRole(req.actor.id, ch.workspaceId);
    if (role === "member") return error(reply, 403, "Admin role required");
    if (!ch.isPrivate) return error(reply, 400, "Only private channels require explicit members");
    const user = db.prepare("SELECT id FROM users WHERE username=?").get(req.body?.username || "");
    if (!user || !workspaceRole(user.id, ch.workspaceId)) return error(reply, 404, "Workspace member not found");
    db.prepare("INSERT OR IGNORE INTO channel_members VALUES(?,?)").run(ch.id, user.id);
    return { ok: true };
  });
  app.post("/api/workspaces/:workspaceId/invites", { preHandler: requireUser }, async (req, reply) => {
    const role = requireWorkspace(req, reply);
    if (!role) return;
    if (role === "member") return error(reply, 403, "Admin role required");
    const requested = req.body?.role === "admin" ? "admin" : "member";
    const inviteToken = token();
    db.prepare("INSERT INTO invites VALUES(?,?,?,?,NULL)")
      .run(hashToken(inviteToken), req.params.workspaceId, requested, Date.now() + 86400_000);
    return reply.code(201).send({ invite: inviteToken, expiresInSeconds: 86400, role: requested });
  });
  app.get("/api/channels/:channelId/messages", { preHandler: requireUser }, async (req, reply) => {
    const ch = requireChannel(req, reply, req.params.channelId);
    if (!ch) return;
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));
    const parentId = typeof req.query?.parentId === "string" ? req.query.parentId : null;
    if (parentId && messageById(parentId)?.channel_id !== ch.id) return error(reply, 404, "Thread not found");
    return db.prepare(`SELECT * FROM messages WHERE channel_id=? AND
      ((? IS NULL AND parent_id IS NULL) OR parent_id=?)
      ORDER BY created_at DESC,id DESC LIMIT ?`).all(ch.id, parentId, parentId, limit).reverse().map(publicMessage);
  });
  app.post("/api/channels/:channelId/messages", { preHandler: requireUser }, async (req, reply) => {
    const ch = requireChannel(req, reply, req.params.channelId);
    if (!ch) return;
    const body = req.body?.body;
    if (!validText(body, MAX_BODY)) return error(reply, 400, "Message must contain 1–4000 characters");
    const parentId = typeof req.body?.parentId === "string" ? req.body.parentId : null;
    if (parentId && (messageById(parentId)?.channel_id !== ch.id || messageById(parentId)?.parent_id)) {
      return error(reply, 400, "Invalid parent message");
    }
    const id = randomUUID();
    db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,NULL,NULL)")
      .run(id, ch.id, req.actor.id, body.trim(), parentId, now());
    const message = publicMessage(messageById(id));
    broadcast(ch.id, { type: "message.created", channelId: ch.id, message });
    return reply.code(201).send(message);
  });
  app.patch("/api/messages/:messageId", { preHandler: requireUser }, async (req, reply) => {
    const old = messageById(req.params.messageId);
    if (!old || !requireChannel(req, reply, old.channel_id)) return;
    if (old.author_id !== req.actor.id) return error(reply, 403, "Only the author may edit");
    if (old.deleted_at) return error(reply, 409, "Message deleted");
    if (!validText(req.body?.body, MAX_BODY)) return error(reply, 400, "Message must contain 1–4000 characters");
    db.prepare("UPDATE messages SET body=?,edited_at=? WHERE id=?").run(req.body.body.trim(), now(), old.id);
    const message = publicMessage(messageById(old.id));
    broadcast(old.channel_id, { type: "message.updated", channelId: old.channel_id, message });
    return message;
  });
  app.delete("/api/messages/:messageId", { preHandler: requireUser }, async (req, reply) => {
    const old = messageById(req.params.messageId);
    if (!old || !requireChannel(req, reply, old.channel_id)) return;
    const role = workspaceRole(req.actor.id, channelFor(req.actor.id, old.channel_id).workspaceId);
    if (old.author_id !== req.actor.id && role === "member") return error(reply, 403, "Insufficient permissions");
    db.prepare("UPDATE messages SET body='',deleted_at=? WHERE id=? AND deleted_at IS NULL").run(now(), old.id);
    const message = publicMessage(messageById(old.id));
    broadcast(old.channel_id, { type: "message.updated", channelId: old.channel_id, message });
    return message;
  });
  app.post("/api/messages/:messageId/reactions", { preHandler: requireUser }, async (req, reply) => {
    const old = messageById(req.params.messageId);
    if (!old || !requireChannel(req, reply, old.channel_id)) return;
    if (old.deleted_at) return error(reply, 409, "Message deleted");
    const emoji = req.body?.emoji;
    if (typeof emoji !== "string" || emoji.length > 12 || emoji.length < 1 || /[<>]/.test(emoji))
      return error(reply, 400, "Invalid reaction");
    const existing = db.prepare("SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?")
      .get(old.id, req.actor.id, emoji);
    if (existing) db.prepare("DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?").run(old.id, req.actor.id, emoji);
    else db.prepare("INSERT INTO reactions VALUES(?,?,?)").run(old.id, req.actor.id, emoji);
    const message = publicMessage(messageById(old.id));
    broadcast(old.channel_id, { type: "message.updated", channelId: old.channel_id, message });
    return message;
  });
  app.get("/api/workspaces/:workspaceId/search", { preHandler: requireUser }, async (req, reply) => {
    if (!requireWorkspace(req, reply)) return;
    const q = String(req.query?.q || "").trim();
    if (q.length < 2 || q.length > 100) return error(reply, 400, "Query must be 2–100 characters");
    const rows = db.prepare(`SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id
      LEFT JOIN channel_members cm ON cm.channel_id=c.id AND cm.user_id=?
      WHERE c.workspace_id=? AND (c.is_private=0 OR cm.user_id IS NOT NULL)
      AND m.deleted_at IS NULL AND instr(lower(m.body),lower(?))>0
      ORDER BY m.created_at DESC LIMIT 40`).all(req.actor.id, req.params.workspaceId, q);
    return rows.map(publicMessage);
  });
  app.server.on("upgrade", (request, socket, head) => {
    try {
      if (new URL(request.url, "http://localhost").pathname !== "/api/events") { socket.destroy(); return; }
      const user = sessionFromRequest(request);
      if (!user || (!user.bearer && !ownOrigin(request))) { socket.destroy(); return; }
      wss.handleUpgrade(request, socket, head, ws => {
        sockets.set(ws, { userId: user.id, sessionHash: user.sessionHash });
        ws.on("close", () => sockets.delete(ws));
        ws.on("error", () => sockets.delete(ws));
        ws.send(JSON.stringify({ type: "connected" }));
      });
    } catch { socket.destroy(); }
  });
  if (serveWeb) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
    if (fs.existsSync(root)) app.register(fastifyStatic, { root, prefix: "/" });
  }
  app.addHook("onClose", async () => {
    for (const ws of sockets.keys()) ws.close();
    wss.close();
    db.close();
  });
  return app;
}
