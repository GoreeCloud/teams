# GitHub Actions supply-chain controls

Development CI uses only these pre-existing, reviewed action repositories:
`actions/checkout`, `actions/setup-node`, `actions/setup-java`,
`actions/upload-artifact` and `subosito/flutter-action`.

All workflow references are pinned to full 40-character commit IDs, resolved
against their official GitHub tag refs on **November 19, 2026**. GitHub's
commit metadata at verification reported each corresponding commit as
verified. Commit metadata and signatures do **not** guarantee the behavior
or safety of an action; changes must still be reviewed, scanned, and tested.

Run `npm run verify:action-pins` locally. The root `npm run check` and
protected `server-web` CI job enforce the same allowlist and immutable-pin
syntax. Review and update the allowlist before adopting any new external
workflow action; the verifier deliberately rejects unreviewed sources,
mutable version tags, and Docker image action references.

Dependabot is configured to suggest weekly updates to GitHub Actions and
npm dependencies via pull requests. It does **not** merge or deploy updates
automatically. Every update must satisfy the protected cross-platform checks
and relevant manual review. Version pinning reduces mutable dependency risk
but is not an independent security audit or a substitute for signed release
artifacts, SBOM review, malware scanning and runtime hardening.

The Linux and Android CI artifacts are **debug** outputs with short
retention and are not signed Stable production releases.

## Production container packaging — separate acceptance

The additional `container-acceptance` workflow builds the actual Dockerfile
on ephemeral GitHub-hosted Ubuntu and starts a synthetic instance with
networking disabled. It checks non-root process identity, private data
permissions and startup safety. This test cannot establish provenance or
reproducibility of the base container image: the Dockerfile still refers
to a mutable `node:24-bookworm-slim` tag. Base-image digest pinning,
reproducible rebuilds, SBOM and image signatures remain open before a
signed production release. This CI does not publish an image to a registry
or access live volumes/credentials.

## Unsigned Linux release preview

The separate `native-linux-release` CI workflow builds the actual
release-mode Flutter Linux bundle, checks for executable/runtime assets,
and publishes a seven-day unsigned tar archive plus SHA256SUMS. Synthetic
tests cover output collision, incomplete bundles, and checksum tampering.
A checksum is not a signature, and this source-only CI artifact has no
production installation, cross-distro, key custody or rollout acceptance.
See [LINUX_PREVIEW_PACKAGING.md](LINUX_PREVIEW_PACKAGING.md).
