import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function openDatabase(filename) {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL, is_private INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, UNIQUE (workspace_id, name)
    );
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(channel_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL,
      parent_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS messages_channel_created ON messages(channel_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS messages_parent ON messages(parent_id);
    CREATE INDEX IF NOT EXISTS messages_channel_parent_history ON messages(channel_id, parent_id, created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL, PRIMARY KEY (message_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS pinned_messages (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      pinned_by TEXT NOT NULL REFERENCES users(id),
      pinned_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pins_by_channel ON pinned_messages(channel_id,pinned_at DESC,message_id DESC);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      id TEXT,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS sessions_user_expires ON sessions(user_id, expires_at DESC);
    CREATE TABLE IF NOT EXISTS invites (
      token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('admin','member')),
      expires_at INTEGER NOT NULL, used_at INTEGER
    );
  `);
  // Preserve existing active sessions when migrating developer SQLite databases.
  // A public, independent UUID permits per-device revocation without exposing
  // bearer tokens or their SHA-256 digests. Legacy creation time is unknown.
  const sessionColumns = db.pragma("table_info(sessions)").map(column => column.name);
  if (!sessionColumns.includes("id")) db.exec("ALTER TABLE sessions ADD COLUMN id TEXT");
  if (!sessionColumns.includes("created_at")) db.exec("ALTER TABLE sessions ADD COLUMN created_at INTEGER");
  db.transaction(() => {
    const pending = db.prepare("SELECT token_hash AS tokenHash FROM sessions WHERE id IS NULL").all();
    const update = db.prepare("UPDATE sessions SET id=? WHERE token_hash=?");
    for (const row of pending) update.run(randomUUID(), row.tokenHash);
  })();
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS sessions_public_id ON sessions(id)");
  // Preserve existing developer databases when evolving the initial schema.
  const channelColumns = db.pragma("table_info(channels)").map(column => column.name);
  if (!channelColumns.includes("kind")) {
    db.exec("ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'channel' CHECK(kind IN ('channel','dm'))");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS direct_conversations (
      channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      member_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      member_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      CHECK (member_a < member_b),
      UNIQUE (workspace_id, member_a, member_b)
    );
    CREATE INDEX IF NOT EXISTS dms_by_workspace ON direct_conversations(workspace_id);
    CREATE TABLE IF NOT EXISTS group_conversations (
      channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS group_conversations_workspace ON group_conversations(workspace_id);

  `);
  return db;
}
