# GoreeCloud Teams

**Self-hosted, open-source team collaboration — web, native Linux and Android.**

GoreeCloud Teams is a new original development-stage alternative to Slack and
Mattermost. This repository contains the application code, native platform
runners, backend, build configuration, tests, container deployment recipe, and
documentation. **Not production ready; no stable release or deployment verified.**

## Implemented development-preview capabilities

- Single-owner first-run setup, local user login, single-use 24-hour invites
- Workspaces, public/private channels and channel access enforcement
- Workspace member directory for teammate selection and admin-controlled private-channel invitations
- One-to-one and 3–30-person private group conversations, with participant-only access and fixed group membership
- Text messages, message edits/deletions, threaded replies, emoji reactions
- Permission-checked, cursor-paginated message and reply history in all clients
- Workspace-scoped search, authenticated WebSocket event fanout
- Responsive React/TypeScript web client with GoreeCloud UI semantic alpha tokens
- Flutter Linux graphical app and Flutter Android app (native framework and runners)
- SQLite persistence with WAL, Argon2id password hashes and opaque sessions
- Basic API tests, Flutter widget test, Linux desktop and Android APK CI jobs with temporary debug artifacts

**Not yet supported:** file attachments, editing group membership, voice/video calls, advanced
permissions, E2EE, complete mobile notifications, offline synchronization,
enterprise SSO/MFA, federation, production readiness and installation/device
acceptance. Native login tokens intentionally do not persist across restarts.

## Prerequisites

- Node.js 24+ and npm (server/web)
- Flutter SDK 3.27.4+ with Android SDK or Linux desktop dependencies (native)
- HTTPS reverse proxy for remote access; Docker/Podman optionally

## Start the server and web app locally

```bash
npm ci
npm run dev:server
# in a second terminal:
npm run dev:web
# open http://127.0.0.1:5173
```

The first account created is the workspace owner, and new registrations then
require an owner/admin-generated invite. Keep the server private until the first
account has been created. Server default: `127.0.0.1:3030`. Vite forwards
`/api` to the server, including WebSockets.

```bash
npm run check
npm run build
npm run start -w @goreecloud/teams-server
```

After building web assets, production mode serves the static frontend from the
Fastify process if `apps/web/dist` exists. Set `TEAMS_DB_PATH` and
`TEAMS_SITE_ORIGIN` appropriately for the host and TLS terminator.

## Online SQLite backups

`npm run backup -- --source /path/teams.sqlite --destination /private/backup/teams-YYYY-MM-DD.sqlite`
takes an integrity-checked online snapshot without copying a live WAL file.
It refuses overwriting an existing destination and protects snapshot file
permissions. See [backup and staged-recovery guidance](docs/BACKUPS.md).
A real off-host backup strategy and staged restore drill remain required
before production acceptance.

## Native Linux / Android

```bash
cd apps/native
flutter pub get
flutter analyze
flutter test
flutter run -d linux
# For Android with a properly configured SDK/device:
flutter run -d <android-device-id>
```

Enter your **own** server URL during onboarding. HTTPS is required except for
loopback development. The native app uses `dart:io`, no WebView/Electron/Tauri.
The Linux runner is a Flutter GTK embedder, with **Flutter** as the primary UI
framework (per GoreeCloud's Linux UI requirement). The generated Android and
Linux runners are included in the repository.

## Container deployment

```bash
cp .env.example .env
# Set TEAMS_SITE_ORIGIN to your real HTTPS origin and configure a trusted TLS proxy
docker compose up --build -d
```

The sample binds only to `127.0.0.1:3030` and mounts persistent `teams_data`.
Do not expose plain HTTP to the public internet. GoreeCloud Containers is the
preferred future deployment owner when installed and independently verified;
the Compose recipe is a portable alternative. A tested backup/restore process
is required before production.

## Repository layout

| Directory | Contents |
| --- | --- |
| `apps/server/` | Fastify API, SQLite schema, auth, ACLs and tests |
| `apps/web/` | React web client and GoreeCloud UI token-based styling |
| `apps/native/` | Flutter Linux and Android app and platform runners |
| `docs/` | Architecture, threat/security caveats, dependency provenance |
| `.github/workflows/` | Automated test and build checks |

## Privacy, security, licenses

The original GoreeCloud-written code is **MIT-licensed** in [LICENSE](LICENSE).
Flutter-generated platform scaffolding and third-party libraries retain their
respective licenses; see [third-party attribution](docs/THIRD_PARTY.md). No
Slack/Mattermost proprietary source has been imported. See the
[security model and limitations](docs/SECURITY.md) and
[architecture](docs/ARCHITECTURE.md).

GoreeCloud UI: [gc-ui](https://github.com/GoreeCloud/gc-ui) is the design
authority; its current semantic values are alpha, not founder-approved final
branding. GoreeShield handles privacy, Wardveil cybersecurity, GoreeCloud
Identity access management and GoreeCloud Mesh integrations. Cross-product
services are not claimed operational merely because their contracts exist.

**Maintainer:** GoreeCloud. Contributions should use reviewable pull requests.
