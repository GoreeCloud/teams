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
- Native apps: one Flutter Linux and Android source, real platform runners and
  APIs. Native login token is intentionally memory-only (re-authentication on
  app restart). Remote HTTP without TLS is refused.
- Sessions: opaque tokens, hashed in the sessions table, 30-day expiry; owner
  bootstrap and single-use, 24-hour invitation codes.
- Channels: public by default. Private channels require explicit membership.
- Direct messages: immutable two-member conversation pairs with unique per-workspace identity, scoped by the same channel authorization and event checks.
- Membership directory: authenticated, workspace-scoped usernames/display names/roles for selecting teammates (up to 500 returned); eligible admins/owners already in a private channel may add existing workspace members. This grants historical channel visibility and is never automatic.
- Messages: basic text, edit, soft delete, replies, reactions and scoped
  substring search. No attachments, group DMs, voice calls, video, presence or
  federation yet.
- Message history: keyset pagination by existing message ID, ordered by
  (created_at, id), maximum 100 rows per request and default 50. Cursors must
  belong to the exact authorized channel and root/reply scope. Web and native
  clients load additional pages on request rather than unbounded fetch.
- Real-time: WebSocket pushes scoped per-channel events; clients merge
  message events into the current view without discarding older loaded pages.
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
