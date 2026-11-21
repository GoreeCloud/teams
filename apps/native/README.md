# GoreeCloud Teams — Native Linux and Android

The Flutter Linux and Android client is located in this directory. This is
first-party Flutter UI source and generated platform runner code, not a WebView
or Electron wrapper. Its authoritative app-level overview is the monorepo's
[root README](../../README.md).

## Development

```bash
flutter pub get
flutter analyze
flutter test
flutter run -d linux
flutter build apk --debug
```

## GoreeCloud UI canonical native colors

Flutter colors for Android and Linux now use the deterministic generated
`lib/generated/gc_ui_tokens.g.dart` constants from the first-party MIT
GoreeCloud UI alpha token registry. Source snapshot, license, reviewed source
commit and strict generation/check commands are in
[`tool/gc-ui/README.md`](tool/gc-ui/README.md). Run
`npm run verify:native-ui-tokens` from the monorepo root before accepting
theme updates. The canonical semantic values match the source-pinned React
web theme, without inventing a competing native palette.

This is source-level adoption of the **colors only**; Android Material 3
Expressive motion/layout, native-device accessibility, and final visual
acceptance remain separate. Flutter stays the approved native Linux UI.

The client prompts for a self-hosted Teams server and refuses remote HTTP
without TLS. Bearer tokens are held in memory, not persisted across restarts. For
first-owner setup of a persisted/hosted server, the Linux and Android login
forms request an obscured operator token from the separately secured server
configuration. The value is cleared after authentication, not saved locally.
It implements channels, private one-to-one and group conversations, a workspace-scoped teammate
directory, owner/admin private-channel membership management, message threads,
scoped search, edits, deletion, reactions, up to 50 permission-scoped pinned
messages per conversation, private Saved for later bookmarks, on-demand
paginated channel/thread history and unread badges which preserve background
conversations as unread. Linux
and Android installation and user-acceptance
testing are distinct from successful source compilation. Release signing and
device acceptance remain incomplete.
Authenticated users may inspect and revoke account sessions without disclosing
session tokens or persisting IP addresses/device fingerprints in session records.
