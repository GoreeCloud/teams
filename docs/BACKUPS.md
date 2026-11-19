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

Store backups in an access-controlled location outside the primary host.
Maintain independent off-host copies and encryption suitable for the operator's
threat model. Backup files contain private message bodies, member metadata,
and password hashes; never put them in a public repository, unprotected bucket
or user-facing error log. Configure schedules only after validating the
authorized host, credentials, monitoring and retention policy.

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
