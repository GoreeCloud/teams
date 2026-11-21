# Teams container packaging acceptance

## Scope and safety

The `container-acceptance` GitHub Actions job builds the repository's
production Dockerfile on an ephemeral Ubuntu runner and executes
`scripts/ci-container-acceptance.sh` against that local image. Runtime
tests use Docker's `--network none` and **never publish container ports**,
mount GoreeCloud host data, provide real credentials, connect to production
systems, or create a service on the GoreeCloud VPS.

It checks:

1. The shipped image runs as a non-root user, uses `NODE_ENV=production`,
   contains the actual entrypoint and data-permission guards, and owns a
   private `/data` directory with mode 0700.
2. The unedited sample `.example` site origin fails closed before an
   application database exists.
3. An intentionally insecure 0755 synthetic data directory is rejected
   without a database file being created and without private paths being
   printed by the entrypoint.
4. A synthetic valid HTTPS-origin startup becomes healthy on the
   container's **own** loopback interface and creates SQLite, WAL and SHM
   files with owner-only mode 0600 and single-link ownership.
5. The test process terminates the temporary server and discards its
   synthetic filesystem after inspection. The runner is ephemeral.

The workflow requires a successful Docker build with the actual pinned
application source and production dependencies. This closes a separate
packaging gap that backend unit tests and source-only workflow checks
cannot detect.

## Limitations

- This is **not production deployment**. It does not validate a real
  reverse proxy, TLS certificate, Docker Compose networking, VPS firewall,
  volume/backup migration, actual host ownership, filesystem encryption,
  SELinux/AppArmor enforcement, or an external monitoring system.
- The Node image still uses a floating `node:24-bookworm-slim` tag and
  fetches packages during Docker build. A reproducible production image
  requires reviewed digest pinning, SBOM, image scan/signature policy and
  release provenance. Do not infer supply-chain trust from green CI alone.
- Android/Linux CI artifacts are development builds, not independently
  signed releases. Device installation, accessibility, upgrades, rollback,
  and disaster recovery acceptance are still outstanding.
- The `TEAMS_SITE_ORIGIN` value in these tests is synthetic. No actual
  GoreeCloud domain ownership, certificate, deployed host, or service
  route is inferred from it.

## Next acceptance gates

Maintain this job as a protected named check **only after** its exact
source branch has passed. Before a live server is approved, separately
verify an operator-owned encrypted backup, private key recovery,
independent off-host copy, real staged restore, security/consent
requirements, signed/native devices and an authorized roll-out plan.
