# Android Gradle network resilience (development CI)

The Flutter Android debug build depends on external Gradle/Maven artifacts.
On November 20, 2026, an otherwise unchanged Teams PR failed when Maven
Central returned **HTTP 429 Too Many Requests** while Gradle attempted to
retrieve `com.squareup:javawriter:2.5.0` and `org.ow2.asm:asm:9.1`.
Flutter's immediate 100 ms retry hit the same rate limit. This was
**external dependency access failure**, not proof of a source compile defect.

The `native-android` CI job uses
`scripts/ci-android-maven-backoff.sh` after normal Flutter dependency
resolution. The script makes at most **three independent debug build attempts**
and retries only when the failure log contains both an explicit HTTP 429 and
Maven Central. Delays between attempts are 20 and 40 seconds. All other
compiler, signing, configuration, Android SDK or unknown failures are
returned immediately with nonzero exit status. Persistent HTTP 429 also
fails after the bounded budget. The original debug APK artifact and other
protected checks remain unchanged.

Synthetic Node tests create a temporary fake Flutter command to prove
retry-on-Maven-429, no retry for ordinary errors, strict three-attempt
limit and controlled delays without making network requests. These are
included in the protected `server-web` source check.

This handling does **not** change Maven repositories, bypass signatures,
force a successful Gradle result, promise artifact availability, install
an APK, provision a signing key, or make the Android app production-ready.
Repeated upstream outages should be recorded as external build blockers
rather than circumvented with unreviewed artifact mirrors.
