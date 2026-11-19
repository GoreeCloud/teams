# Security and privacy model (development stage)

## Boundaries
- **Identity**: Local accounts use Argon2id password hashes. Login issues a
  random opaque 256-bit session token; only its SHA-256 digest is stored in
  SQLite. Browser cookies are HttpOnly / SameSite=Strict and Secure when
  NODE_ENV=production. Native clients keep the token in memory only and pass
  it in the Authorization header. There is no SSO or MFA yet.
- **Authorization**: Every workspace, channel, message, reply, search, and
  event is checked against workspace membership and (for private channels)
  explicit channel membership. The authenticated workspace member directory exposes only user IDs, usernames, display names and roles to other workspace members. One-to-one conversations have immutable two-member membership; private group conversations have fixed 3–30-person membership, and neither can be expanded through channel-management APIs. Only admins/owners may invite or add channels;
  only authors edit their messages.
- **GoreeShield**: No product telemetry or ad tracking. Search and private
  channels are scoped to authorized viewers. Data lives in an operator-owned
  SQLite volume. Retention/export/delete policy controls are not yet complete.
- **Wardveil**: Input validation, bounded payloads, login attempt limits,
  origin verification for cookie mutations/WebSockets, minimal security
  headers, and container least privilege are implemented. These are not a
  substitute for threat modeling, penetration testing, or an audit.
- **Mesh**: No automatic external data transfer or integration enabled.
  External APIs and cross-product sync are future work behind separate
  consent and authorization controls.

## Production conditions
Use a TLS reverse proxy and set TEAMS_SITE_ORIGIN exactly to the external HTTPS
origin. Keep the HTTP backend bound to localhost. Back up the SQLite volume
including WAL state using a verified SQLite online backup method, not arbitrary
live-file copying. Restore only to a staged destination and test it. Protect
filesystem permissions, host firewall, credentials, and reverse-proxy headers.
Avoid public account bootstrapping: the **first registration is automatically
the owner**. Place the server behind a trusted private network until initial
setup completes.

## Session-bound WebSocket authorization

Each authenticated WebSocket retains only its session digest, not its bearer
secret. Message and direct-message fanout verify the session has not been
revoked or expired before delivery. Logging out explicitly closes all sockets
associated with that exact session while preserving separate device sessions.
A synthetic integration test verifies logout isolation and TTL expiry at the
next event. Full session management, MFA and production monitoring are not
implemented; expired but idle sockets are closed on the next event rather
than by an independent periodic expiration sweep.

## Verified snapshot implementation

The `scripts/backup.mjs` CLI uses SQLite's online backup API to capture
committed WAL state to a private, integrity-checked, no-overwrite snapshot.
See [BACKUPS.md](BACKUPS.md). Backups contain private messages and hashes:
encrypt them at rest/off-host, apply GoreeShield retention policies and test
restoration on staging. This is not a production recovery acceptance.

## Known blockers before production
- Password reset, MFA, external Identity SSO, device/session management.
- Enforced account/user/channel rate limits beyond IP login attempts.
- Per-workspace migrations and DB concurrency/stress/restore testing.
- Moderation, abuse controls, sanitization of future rich content and files.
- Key rotation/revocation workflow, audit trail, incident response and backups.
- Encryption at rest/E2EE is **not** implemented; TLS is mandatory remotely.
- Full CSRF/proxy/TLS/WebSocket real-world validation and security review.

Please report vulnerabilities privately through the repository security
reporting feature when enabled; do not publish exploit details in public issues.
