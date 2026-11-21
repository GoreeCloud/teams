# GoreeCloud Teams — unsigned Linux release preview

The separate `native-linux-release` GitHub Actions workflow builds
the **actual Flutter Linux release-mode bundle** from the checked-in
Flutter 3.27.4 source on Ubuntu 24.04. The existing `native-linux`
debug-build check remains independently required.

The packaging script verifies the compiled `goreecloud_teams`
executable, the ICU data file, Flutter assets and GTK Flutter runtime
library before creating an archive. It writes an
`goreecloud-teams-linux-x64-release-unsigned.tar.gz` bundle and
`SHA256SUMS` to a private directory, refuses to replace existing
outputs, verifies the archive can be listed, and rechecks SHA-256.
Synthetic tests exercise success, checksum tampering, missing bundle
files, insecure output permissions and no-overwrite behavior.

The GitHub artifact name deliberately includes
`unsigned-preview`, and retention is limited to seven days.
An artifact is **not** a production installer, signed update,
Stable release, package-manager distribution, or proof of actual
Linux desktop installation. A SHA-256 manifest detects changes to the
published bytes but is **not** an independent signature or provenance
attestation.

## Release and device blockers

Actual Linux desktop acceptance must test launch, GTK behavior,
Wayland and X11 environments as applicable, accessibility, correct
GoreeCloud UI tokens, TLS connectivity, account revocation, crashes,
updates/rollback, filesystem permissions, cross-distro packaging,
approved distribution signing and disaster recovery with an
authorized device. Do not treat a headless CI compile or synthetic
tar validation as completion of those requirements.

No private signing keys, tokens, live instances or existing user data
are accessed by this preview workflow. The production release gate
remains open until signed and installed release packages are verified.
