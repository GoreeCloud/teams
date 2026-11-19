# Security and privacy model (development stage)

## Boundaries
- **Identity**: Local accounts use Argon2id password hashes. Login issues a
  random opaque 256-bit session token; only its SHA-256 digest is stored in
  SQLite. Browser cookies are HttpOnly / SameSite=Strict and Secure when
  NODE_ENV=production. Native clients keep the token in memory only and pass
  it in the Authorization header. There is no SSO or MFA yet.
- **Authorization**: Every workspace, channel, message, reply, search, and
  event is checked against workspace membership and (for private channels)
  explicit channel membership. Private-channel member removal immediately blocks message/history access, search and event fanout; only existing channel admins/owners may remove members, not themselves or the workspace owner. The authenticated workspace member directory exposes only user IDs, usernames, display names and roles to other workspace members. One-to-one conversations have immutable two-member membership; private group conversations have fixed 3–30-person membership, and neither can be expanded through channel-management APIs. Only admins/owners may invite or add channels;
  only authors edit their messages.
- **Pinned content**: Pin lists and mutations use the same channel/private
  conversation authorization as messages. Any authorized participant can pin;
  the pinner or a workspace administrator/owner with access can unpin.
  Soft-deleting messages removes corresponding pins; pinned text is not copied
  into a separate public index. A 50-pin limit restricts unbounded accumulation.
- **Unread/read privacy**: The server stores only the account, channel and
  last-read root-message timestamp/ID in SQLite. Read markers are monotonic,
  channel-authorized and visible to the account's own active sessions only;
  no other user's read receipts, IPs or foreground activity are exposed.
  Native and web clients avoid marking background messages read.
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
next event. Users can list their active sessions, revoke one, or revoke all
others. Session listings disclose only a random public UUID, optional creation
time, expiry time and current-session indicator, not bearer hashes or client
identifiers. Legacy sessions retain their original authentication and receive
stable random IDs with an unknown creation timestamp. Each revoked session's
active WebSockets close immediately. Web and Flutter clients treat a server
WebSocket policy-close (1008) as revocation and return to sign-in without
persisting the invalid token; ordinary transport closures do not force logout.
Session administration is not MFA/SSO or
full multi-device identity governance; expired but idle sockets close on the
next event rather than on an independent periodic expiration sweep.

## Verified snapshot implementation

The `scripts/backup.mjs` CLI uses SQLite's online backup API to capture
committed WAL state to a private, integrity-checked, no-overwrite snapshot.
See [BACKUPS.md](BACKUPS.md). Backups contain private messages and hashes:
encrypt them at rest/off-host, apply GoreeShield retention policies and test
restoration on staging. This is not a production recovery acceptance.

## Attachment trust boundary (disabled by default)

The optional attachment API rejects uploads without an explicitly injected,
independently verified scanner adapter. Unit and integration tests use only
synthetic verdicts. Private path-backed blobs are limited to 2 MiB with strict
filenames, type allowlists, SHA-256 read checks and authorization on every
download. The shipped server does not enable attachment uploads or client
attachment controls. SQLite snapshots do not include blob storage. Wardveil
scanner integration, GoreeShield retention/encryption controls, coordinated
backup/restore and recovery reconciliation remain separate acceptance gates.
See [ATTACHMENTS.md](ATTACHMENTS.md).

## Bounded login-attempt and password-check admission

The login endpoint has an in-process, per-socket-IP failure budget of ten
rejected attempts in fifteen minutes. It also caps simultaneous password
verification to two attempts per IP and eight globally, while retaining at
most 2,048 active failure buckets per process. At saturation, admission fails
closed with HTTP 429; this can inconvenience users behind a shared NAT.
Client-supplied X-Forwarded-For cannot bypass the limit because the Fastify
backend has `trustProxy: false`.

Rate-limit keys are HMAC-SHA256 digests under a new random key for each
process, never raw client IPs. They are not logged or persisted and expired
inactive buckets are recycled on subsequent attempts. There is no
cross-instance distributed limiter, production perimeter abuse control,
background key expiry task, or independent security audit; these remain
acceptance requirements before external deployment.

## Known blockers before production
- Password reset, MFA, external Identity SSO and advanced device/session governance.
- Account/user/channel rate limits beyond bounded, per-process IP login admission.
- Per-workspace migrations and DB concurrency/stress/restore testing.
- Moderation, abuse controls, sanitization of future rich content and files.
- Key rotation/revocation workflow, audit trail, incident response and backups.
- Encryption at rest/E2EE is **not** implemented; TLS is mandatory remotely.
- Full CSRF/proxy/TLS/WebSocket real-world validation and security review.

Please report vulnerabilities privately through the repository security
reporting feature when enabled; do not publish exploit details in public issues.
