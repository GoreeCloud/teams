# Teams architecture

```text
React / TypeScript web ──HTTPS──┐
Flutter Linux UI ───────HTTPS───┼── Fastify HTTP API ── SQLite WAL
Flutter Android UI ─────HTTPS───┤         │
All clients ───────WebSocket───┘         └── Scoped event fanout
```

- Source of truth: user-owned SQLite on the self-hosted server.
- Web app: React 19 + Vite, same-origin API and WebSocket (no tokens in
  browser storage). GoreeCloud UI semantic tokens inform both themes.
- Native GoreeCloud UI semantic colors: reviewed, MIT-licensed alpha registry
  snapshot from `GoreeCloud/gc-ui` generates one deterministic Flutter Dart
  color library for both platforms; the repo check verifies source hash and
  React/Flutter color parity. Native Material 3 Expressive acceptance remains
  independent of theme-color parity.
- Native apps: one Flutter Linux and Android source, real platform runners and
  APIs. Native login token is intentionally memory-only (re-authentication on
  app restart). Remote HTTP without TLS is refused.
- Authentication admission: bounded HMAC-keyed per-IP login failure windows
  (10 failures/15 minutes, 2 concurrent per socket IP, 8 global, max 2,048
  transient buckets). No persistence of rate-limit IPs or proxy header trust.
  Not a distributed, production-grade abuse-control layer. A separate bounded
  in-process registration admission limits invite guessing and Argon2id
  creation hashes (10 failures/15 minutes, 1 per IP and 2 global in flight,
  1,024 retained keyed buckets).
- Sessions: opaque tokens, hashed in the sessions table, 30-day expiry; owner
  bootstrap with an operator-controlled first-owner setup token by default;
  only explicitly opted-in in-memory test fixtures bypass this; new members
  use single-use 24-hour invitation codes. Separate random UUID
  handles allow listing and revocation of one's own sessions without revealing
  secret digests. Existing sessions are migrated in place, with no invented
  creation timestamp. No device fingerprints/IP/User-Agent metadata is stored in session records.
- Channels: public by default. Private channels require explicit membership.
- Direct messages: immutable two-member conversation pairs with unique per-workspace identity, scoped by the same channel authorization and event checks.
- Group conversations: independently titled private channels with immutable 3–30-person memberships, selected from verified workspace users. Group and direct messages reuse the same message, reaction, thread, search, authorization and WebSocket infrastructure. Group membership editing is not yet supported.
- Membership directory: authenticated, workspace-scoped usernames/display names/roles for selecting teammates (up to 500 returned); authorized private-channel admins/owners may list, add and remove existing workspace members. Adding grants historical visibility; removal immediately blocks channel history, search and private event fanout. Group-DM membership remains fixed and separate.
- Messages: basic text, edit, soft delete, replies, reactions and scoped
  substring search. The separate scanner-gated attachment API foundation
  binds private UUID blobs to authorized messages but is not enabled in the
  shipped server or in any client; see [ATTACHMENTS.md](ATTACHMENTS.md).
  No production attachments, voice calls, video, presence or
  federation yet.
- Pinned messages: bounded to 50 per channel/conversation, stored in an additive
  SQLite table. All reads/mutations validate channel authorization, while
  unpin is limited to the pinner or a workspace administrator/owner who is
  also a member. Deleting a message also removes its pin. Real-time updates
  reuse the scoped message.updated event.
- Message history: keyset pagination by existing message ID, ordered by
  (created_at, id), maximum 100 rows per request and default 50. Cursors must
  belong to the exact authorized channel and root/reply scope. Web and native
  clients load additional pages on request rather than unbounded fetch.
- Personal saves: SQLite `saved_messages` references existing messages by
  account, message ID and save time without copying message content. Bounded
  (500 per account), cursor-paginated, workspace-scoped read APIs verify current
  channel permissions on every access; private membership removal purges that
  member's bookmarks. Save state events target only the account's sessions.
  All three clients provide Saved for later lists distinct from channel-wide
  pinned messages. See [SAVED_MESSAGES.md](SAVED_MESSAGES.md).
- Unread state: the server persists per-account, per-channel monotonic
  (created_at, id) root-message cursors in SQLite. Only authorized channels,
  private conversations and group DMs are returned by workspace unread counts.
  Counts exclude the account's own messages, deleted messages and threaded
  replies. Read requests require an actual root message in that same channel,
  cannot move the cursor backwards, and notify only the account's sessions.
  Web and Flutter clients show sidebar counts; they acknowledge only a visible,
  foreground conversation. No read receipts are disclosed to other users and
  offline push notifications are not implemented. Expensive workspace counts
  have not received a production-scale benchmark.
- Real-time: WebSocket pushes scoped per-channel events; clients merge
  message events into the current view without discarding older loaded pages.
  Web transport retries unexpected interruptions with capped exponential delays.
  After reconnection, the client revalidates authorized workspace membership and
  fetches the most recent root/thread pages, retaining messages newer than the
  fetched snapshot. Replaced older pages can be loaded again; **events beyond
  the latest 50 root/reply messages are not guaranteed to be recovered**.
  Session-policy closure (1008) never reconnects automatically.
  No durable event queue, background notification delivery or offline conflict
  resolution.
- MIPS: design tokens are an alpha dependency; GoreeShield (privacy),
  Wardveil (security), Identity and Mesh remain distinct future integration
  contracts, not falsely labeled as deployed platform adapters.

## Future technical extension points
- PostgreSQL/Meilisearch adapters once concurrency and indexing demand them.
- S3-compatible encrypted object storage for file sharing with content scans.
- Jitsi or LiveKit for calls with separate license/security review.
- OpenID Connect identity broker instead of local password database.
- Push notifications, offline outbox, accessibility and device testing.
