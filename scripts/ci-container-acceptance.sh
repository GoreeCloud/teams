#!/usr/bin/env bash
# Synthetic, network-isolated packaging acceptance on an ephemeral GitHub runner.
# Never connect this test to live host volumes, credentials, or published ports.
set -euo pipefail

image="${1:?Pass the locally built Teams image tag}"
case "$image" in
  ""|*[[:space:]]*) echo "Invalid local image tag" >&2; exit 2;;
esac

# Confirm the non-root runtime and owner-only image volume metadata; no
# authentication secret, SQLite bytes, or live host directory is accessible.
docker run --rm --network none --entrypoint node "$image" -e '
  const fs = require("node:fs");
  const assert = require("node:assert/strict");
  assert.notEqual(process.getuid(), 0, "runtime must not run as root");
  assert.equal(process.env.NODE_ENV, "production");
  const data = fs.lstatSync("/data");
  assert.equal(data.isDirectory(), true);
  assert.equal(data.mode & 0o777, 0o700);
  assert.equal(data.uid, process.getuid());
  for (const source of ["apps/server/src/index.mjs", "apps/server/src/launch-config.mjs",
                        "apps/server/src/private-database.mjs"]) {
    assert.equal(fs.existsSync(source), true, source + " not shipped");
  }
'

# Direct production launch with the packaged .example placeholder must fail
# *before* creating the database. This only inspects the container's own data.
docker run --rm --network none \
  -e TEAMS_SITE_ORIGIN=https://teams.yourdomain.example \
  --entrypoint sh "$image" -ec '
    set +e
    node apps/server/src/index.mjs > /tmp/blocked.log 2>&1
    result=$?
    set -e
    [ "$result" -eq 1 ]
    [ ! -e /data/teams.sqlite ]
    grep -q "Teams startup configuration rejected" /tmp/blocked.log
  '

# A mispermissioned *synthetic* SQLite volume inside an isolated container
# must fail closed without changing any files or exposing private path details.
docker run --rm --network none \
  -e TEAMS_SITE_ORIGIN=https://teams.goreecloud.com \
  -e TEAMS_DB_PATH=/tmp/exposed/teams.sqlite \
  --entrypoint sh "$image" -ec '
    mkdir -m 0755 /tmp/exposed
    set +e
    node apps/server/src/index.mjs > /tmp/blocked.log 2>&1
    result=$?
    set -e
    [ "$result" -eq 1 ]
    [ ! -e /tmp/exposed/teams.sqlite ]
    [ "$(stat -c "%a" /tmp/exposed)" = 755 ]
    grep -q "Teams private database storage rejected" /tmp/blocked.log
    ! grep -q "/tmp/exposed" /tmp/blocked.log
  '

# Legitimate synthetic production configuration launches inside a container
# with --network none, never publishing or forwarding port 3030 to the host.
docker run --rm --network none \
  -e TEAMS_SITE_ORIGIN=https://teams.goreecloud.com \
  --entrypoint sh "$image" -ec '
    node apps/server/src/index.mjs > /tmp/server.log 2>&1 &
    server=$!
    trap '\''kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true'\'' EXIT
    ready=0
    count=0
    while [ "$count" -lt 30 ]; do
      if node -e '\''fetch("http://127.0.0.1:3030/api/health")
        .then(async r => {
          if (!r.ok) process.exit(1);
          const body = await r.json();
          process.exit(body.status === "ok" && body.product === "GoreeCloud Teams" ? 0 : 1);
        }).catch(() => process.exit(1));'\''; then
        ready=1
        break
      fi
      count=$((count + 1))
      sleep 1
    done
    [ "$ready" -eq 1 ] || { echo "Synthetic container readiness failed" >&2; exit 1; }
    node -e '\''
      const fs = require("node:fs"), assert=require("node:assert/strict");
      const files=["/data/teams.sqlite","/data/teams.sqlite-wal","/data/teams.sqlite-shm"];
      const dir=fs.lstatSync("/data");
      assert.equal(dir.mode & 0o777,0o700);
      assert.equal(dir.uid,process.getuid());
      for (const file of files) {
        const stat=fs.lstatSync(file);
        assert.equal(stat.isFile(),true);
        assert.equal(stat.mode & 0o777,0o600,file+" must be 0600");
        assert.equal(stat.uid,process.getuid());
        assert.equal(stat.nlink,1);
      }
    '\''
  '

echo "Synthetic non-root, no-network Teams container acceptance passed"
