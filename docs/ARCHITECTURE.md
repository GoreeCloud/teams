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
- Group conversations: independently titled private channels with immutable 3–30-person memberships, selected from verified workspace users. Group and direct messages reuse the same message, reaction, thread, search, authorization and WebSocket infrastructure. Group membership editing is not yet supported.
- Membership directory: authenticated, workspace-scoped usernames/display names/roles for selecting teammates (up to 500 returned); eligible admins/owners already in a private channel may add existing workspace members. This grants historical channel visibility and is never automatic.
- Messages: basic text, edit, soft delete, replies, reactions and scoped
  substring search. No attachments, voice calls, video, presence or
  federation yet.
- Real-time: WebSocket pushes scoped per-channel events; clients refresh
  messages on receipt. No durable event queue or offline conflict resolution.
- MIPS: design tokens are an alpha dependency; GoreeShield (privacy),
  Wardveil (security), Identity and Mesh remain distinct future integration
  contracts, not falsely labeled as deployed platform adapters.

## Future technical extension points
- PostgreSQL/Meilisearch adapters once concurrency and indexing demand them.
- S3-compatible encrypted object storage for file sharing with content scans.
- Jitsi or LiveKit for calls with separate license/security review.
- OpenID Connect identity broker instead of local password database.
- Push notifications, offline outbox, accessibility and device testing.
