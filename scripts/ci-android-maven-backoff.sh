#!/usr/bin/env bash
# Bounded retry only for the exact observed external Maven HTTP 429 condition.
# Do not hide compile/test failures behind indiscriminate CI retries.
set -euo pipefail

if [ "$#" -ne 0 ]; then
  echo "No arguments expected: run from the Flutter app directory" >&2
  exit 2
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
attempt=1
max_attempts=3
while [ "$attempt" -le "$max_attempts" ]; do
  : > "$log"
  if flutter build apk --debug > "$log" 2>&1; then
    cat "$log"
    echo "Flutter Android debug build completed"
    exit 0
  else
    code=$?
  fi
  cat "$log"
  if [ "$attempt" -ge "$max_attempts" ] ||
     ! grep -Eiq '(status code 429|HTTP 429|Too Many Requests)' "$log" ||
     ! grep -Eiq '(repo\.maven\.apache\.org|maven central)' "$log"; then
    echo "Flutter build failed without a retryable external Maven 429 (or retry budget exhausted)" >&2
    exit "$code"
  fi
  # Bounded 20s/40s waits only after independently observed Maven rate limits.
  # Flutter's internal 100ms retry is too short for persistent 429 responses.
  delay=$((20 * attempt))
  echo "Maven Central HTTP 429; retrying Flutter once more after ${delay}s (attempt ${attempt}/${max_attempts})" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done
echo "Retry budget exhausted" >&2
exit 1
