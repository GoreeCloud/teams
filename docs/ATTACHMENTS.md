# Private attachment foundation — development-only

**Status:** A bounded, authorized attachment API and storage foundation exists,
but GoreeCloud Teams does **not** enable attachments in the shipped server or
expose file attachment controls in the web/Linux/Android apps. Uploads are
**fail-closed** (HTTP 503) unless a separately reviewed scanner is explicitly
injected into `createServer`. This is not a production-ready attachment system.

## Contract

Trusted server code may configure:

```js
createServer({
  databaseFile: "/private/teams.sqlite",
  attachmentDirectory: "/private/teams-attachments",
  scanAttachment: async ({ bytes, filename, mimeType, sha256, signal }) => {
    // Only a separately audited, isolated Wardveil-approved scanner can
    // return { verdict: "clean" }. Unknown, errors and timeouts deny uploads.
  }
});
```

The scanner callback is a contract, **not a built-in scanner**. Synthetic tests
inject an in-process fake scanner. Do not wire unreviewed binaries, remote
services, shell commands or untrusted packages into this callback. It must
check the full bytes, honor the abort signal and return only an independently
verified clean verdict. Scanner failures, unknown verdicts and the 10-second
request timeout deny publication. The application entrypoint does not inject
this callback, so merely setting a directory does not enable uploading.

An authorized member may POST JSON to
`/api/channels/:channelId/attachments` with the fields
`filename`, `mimeType`, `dataBase64`, optional `caption`, and optional
`parentId`. The API atomically associates one scanned blob with a new
message and emits the normal authorized `message.created` event.

Validation is deliberately narrow: no path components, ASCII filenames up to
128 characters, canonical base64, maximum 2 MiB decoded bytes, and only
`text/plain` (UTF-8 without NUL), `image/png`, or `image/jpeg` with
matching basic signatures. Unsupported file types remain rejected.
The workspace's attachment metadata quota is 128 MiB.

For existing attachment messages, authorized members can GET
`/api/attachments/:attachmentId`. The response is an octet-stream download
with `Content-Disposition: attachment`, no cache, and content sniffing
disabled. Requests must pass session, workspace, channel and undeleted-message
authorization. Every read verifies file size and SHA-256. Public message
objects include only `id`, `filename`, `mimeType` and `size`; they never
include file bytes or storage paths.

## Security and privacy boundaries

- New blobs have UUID storage keys, owner-only file permission (0600), and
  are written only under a private real directory (0700). The directory path
  is an administrator-provided absolute path, never derived from user input.
- No upload bytes reach persistent storage before a clean verdict; session and
  channel membership are rechecked after the asynchronous scan.
- Deleting a message with attachments removes its attachment files and
  metadata before completing the message deletion, returning an error if a
  file cannot be removed. Accidental file loss or power interruption can still
  leave missing-file metadata or orphaned blobs; reconciliation and verified
  retention cleanup are **not** implemented.
- The original database backup CLI protects **SQLite data only**. A separate
  optional [private bundle backup](BACKUPS.md) captures a verified SQLite
  snapshot and exactly its referenced private blobs; it refuses missing or
  tampered files. Real encrypted off-host copies, retention, recovery drills
  and server acceptance are still required before attachments are enabled.
  File encryption at rest, malware scanner deployment, object storage,
  DLP, quotas per user and audit trails remain future GoreeShield/Wardveil work.
- Test verdicts and local tests are not evidence that malicious files will be
  detected by a real scanner.

## Outstanding acceptance gates

Implement and review a Wardveil-owned scanner adapter, fail-closed background
reconciliation, storage encryption/policy, recovery of SQLite plus private
blobs, rate controls, auditability, accessible upload/download components in
all three clients, and real-device plus staging tests. Do not expose a file
upload endpoint on a public server until those controls are verified.
