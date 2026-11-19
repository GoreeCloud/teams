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

The client prompts for a self-hosted Teams server and refuses remote HTTP
without TLS. Bearer tokens are held in memory, not persisted across restarts.
It implements channels, private direct messages, message threads, scoped search,
edits, deletion and reactions. Linux and Android installation and user-acceptance
testing are distinct from successful source compilation. Release signing and
device acceptance remain incomplete.
