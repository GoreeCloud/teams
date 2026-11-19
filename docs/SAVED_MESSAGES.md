# Personal saved messages

**Maturity:** Development preview; web, Linux and Android source only. This is
a personal bookmark workflow, **not** shared channel-wide pinned messages.

## User behavior

In a channel, direct message, group DM or thread, choose **Save for later**
from a message's action menu (bookmark icon on web). The Saved for later
navigation item opens a private, per-workspace list. Each entry shows the
message author/body and its conversation context, offers a link to open
the conversation, and allows the user to remove the bookmark. The list is
keyset-paginated 50 entries at a time. Opening a conversation does not
guarantee navigation to the exact older saved message; navigate its history
using the existing history pagination when needed.

The bookmark state is stored server-side and synchronized to the account's
other sessions through a metadata-only WebSocket `saved.changed` event.
It is not broadcast to teammates. A maximum of 500 saved messages per account
limits unbounded personal metadata growth.

## API

All routes use existing authenticated sessions and existing cookie-origin
checks on mutations; user-supplied paths never grant message visibility.

- `POST /api/messages/:messageId/save` — save an existing, undeleted,
  currently authorized message; idempotent.
- `DELETE /api/messages/:messageId/save` — remove only the caller's bookmark,
  idempotently, even after channel access is revoked; returns no message data.
- `GET /api/workspaces/:workspaceId/saved-ids` — caller's currently accessible
  saved message IDs in that workspace, bounded at 500.
- `GET /api/workspaces/:workspaceId/saved?limit=50&before=<messageId>` —
  newest-first page, maximum 100; cursor is an existing saved entry for the
  same account and workspace, and must remain currently authorized. Each row
  includes `message`, `savedAt`, `channelName`.

All database queries are parameterized and private-channel ACLs apply at
retrieval, not just initial saving. A deleted message disappears from saved
history and loses its bookmark records. Removing a private-channel member
atomically discards their saved bookmarks from that channel, preventing old
bookmarks from reappearing if membership is later restored.

## Privacy and recovery

**GoreeShield** remains the privacy authority. Personal bookmark metadata
contains only account ID, message ID and save timestamp; no client IP,
device fingerprint, remote telemetry, or teammate-visible read receipt.
Message contents are already stored on the Teams server; this feature
references them instead of duplicating their bodies.

**Wardveil** remains responsible for malware/security controls. Saved messages
do not bypass file-attachment scanning, private-message ACLs or
GoreeCloud Identity roles. This feature does not create E2EE, data-retention
policy automation, secure erase guarantees or public sharing.

SQLite WAL snapshots include bookmark metadata. Production recovery,
off-host encryption, audited GoreeShield retention, and mobile installation
testing remain separate release gates.

## Validation

Server integration tests cover per-account isolation, unauthorized private
channels, deletion cleanup, revoked access and re-invite, 105-item pagination,
invalid/cross-account cursors, and metadata-only, self-scoped WebSocket events.
Web and Flutter framework builds and protected CI provide source-level
validation only; do not claim live deployment or device acceptance.
