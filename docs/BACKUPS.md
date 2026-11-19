# Backups and staged recovery (development)

GoreeCloud Teams stores its chat database in SQLite WAL mode. **Do not copy a
live `.sqlite` file by itself**, because committed transactions may still exist
in its WAL. Instead use SQLite's online backup API.

## Creating an operator-managed snapshot

From the monorepo root after `npm ci`:

```bash
npm run backup -- --source /path/to/teams.sqlite --destination /private/backup/teams-2026-11-19.sqlite
```

The command creates an isolated private staging directory, uses the online
SQLite backup API, verifies the snapshot with SQLite integrity and foreign-key
checks, sets file mode 0600, and publishes only to an **unused** destination
filename. A completed backup preserves committed data visible to SQLite
(including WAL transactions). It does not include external attachments or
system configuration.

For a development Compose instance, the script is also packaged in the server
image, so a temporary snapshot can be created using:

```bash
docker compose exec teams node scripts/backup.mjs --source /data/teams.sqlite --destination /data/teams-snapshot.sqlite
```

**This example writes to the same data volume and is not an off-host backup.**
Move the verified snapshot to properly encrypted, access-controlled off-host
storage immediately, and do not leave long-lived copies in the live volume.

Store backups in an access-controlled location outside the primary host.
Maintain independent off-host copies and encryption suitable for the operator's
threat model. Backup files contain private message bodies, member metadata,
and password hashes; never put them in a public repository, unprotected bucket
or user-facing error log. Configure schedules only after validating the
authorized host, credentials, monitoring and retention policy.

## Complete private attachment bundle (operator initiated)

The SQLite-only command above **does not** capture attachment blobs. For a
staged development instance with a verified private attachment directory,
the separate bundle command captures a consistent SQLite online snapshot and
**exactly the blobs referenced in its attachment table**:

```bash
npm run backup:bundle -- \
  --source /private/teams.sqlite \
  --attachments /private/teams-attachments \
  --destination /private/backup/teams-bundle-2026-11-19

npm run backup:bundle -- --verify /private/backup/teams-bundle-2026-11-19
```

The destination directory must **not exist**, must not overlap source
attachments or the database, and cannot overwrite an existing backup. The
source attachment directory must already be a real, private 0700 directory;
only valid UUID-named blobs matching snapshot metadata are admitted. The
backup creates private 0700 folders with 0600 SQLite, file and manifest
entries. SQLite is backed up with its online API (including committed WAL),
then finalized into a standalone database without WAL/SHM sidecars. Every
referenced blob is re-read with no symlink following, size limits and SHA-256
validation; missing, altered or unsafe blobs make the entire operation fail
and remove its incomplete destination. A checksummed `COMPLETE` marker is
written last. Verification rechecks the marker, complete file inventory,
SQLite integrity and foreign keys, snapshot digest and every attachment.

This is **plaintext backup data**, not end-to-end encryption, signatures,
authenticity against a write-capable attacker, scheduled replication, off-host
resilience or a guarantee that future application versions can restore it.
An application upload or deletion racing the snapshot may cause the bundle
to fail closed; the operator must retry, rather than reuse a partial copy.
Keep a real independent encrypted off-host copy with an approved retention
policy. Treat the manifest (including blob IDs and hashes) as sensitive.

Before a real restore, independently verify the bundle and **copy** its
standalone `database.sqlite` and the entire `attachments/` directory into
a fresh private staging directory. Configure the staged Teams server to use
those copies, never the backup bundle itself. Validate login, channel
permissions, attachment downloads and deletions in that isolated environment.
Automated synthetic tests exercise this process, but they do not replace
a real host/device restore drill or service rollback plan.

## Nonproduction restore verification

1. Stop any *staging* Teams process that owns your **restore target**. Never
   overwrite a live production database for a test.
2. Copy the verified snapshot to a distinct private staging destination.
3. Run an offline `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on
   the staged file; then launch a staging Teams instance with `TEAMS_DB_PATH`
   pointing to the staged copy.
4. Verify synthetic test users, channels, private permission behavior,
   session revocation and application recovery, with no network exposure.
5. Record the observed recovery point and timing separately. Do not call a
   process production-ready until a real staged restore drill succeeds.

The automated tests validate snapshot consistency and recovery *readability*.
They do not prove off-host replication, encryption, retention, automated
scheduling, full disaster recovery, or an approved production restore drill.
