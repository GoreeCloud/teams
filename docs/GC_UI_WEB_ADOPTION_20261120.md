# GoreeCloud Teams — first-party GoreeCloud UI semantic source adoption

**Scope:** November 20, 2026, development **React web surface only**. This is not a Stable release, approved product-wide visual redesign, deployed web service, or native Flutter UI migration.

## Ownership and exact source

- First-party design authority: [GoreeCloud/gc-ui](https://github.com/GoreeCloud/gc-ui), protected-main source commit `2537a80e39941f392d2e13e5177fe87ee8499438` (alpha, not released Stable).
- Teams owns its independent React workspace, navigation, channels/messages, same-origin session APIs and WebSocket event coordination. The Web client now copies **only** the first-party generated semantic CSS tokens and upstream MIT license to `apps/web/src/vendor/gc-ui/`. Exact SHA-256 hashes and commit are in `provenance.json`, tested before the build. It neither imports UI runtime dependencies nor fetches styles from external hosts.
- Local aliases `--canvas`, `--surface`, `--surface-tonal`, `--text`, `--text-soft`, `--outline`, `--brand`, `--on-brand`, `--brand-subtle` and `--positive` now resolve to official `--gc-*` semantic roles instead of manually duplicated Iris color constants.
- Teams intentionally retains its own responsive layout, decorative color treatments, spacing, shadows, animations, icons and product-specific visual composition. This source pin alone is not founder approval, full design adoption, or global aesthetics certification.

## Automatic appearance stays automatic

The preexisting web client followed the operating system's light/dark preference using CSS. Its startup now reads the same `(prefers-color-scheme: dark)` media query, selects `data-gc-theme` on the document root and updates the browser `theme-color` metadata from the **computed official canvas role**. A `change` event updates the palette when the OS preference changes. This is an in-memory browser appearance choice only: **no network request, cookies, localStorage, or telemetry**. Existing product-specific light-mode details remain inside the original CSS media query, with locally distinct shadows.

## Source-bound validation

For local **web-only** verification from the repository root, run `npm ci --ignore-scripts`, `npm run build`, `npm run test:realtime`, and `npm audit --omit=dev --audit-level=high`. This passed on the laptop: **8/8 Node web tests**, TypeScript/Vite production build, and **zero high/critical production dependency audit findings**. The existing root `npm run test:realtime` includes `apps/web/test/gc-ui-source.test.mjs`, guarding pinned source hashes, license, theme synchronization, CSS-before-product import ordering, and semantic aliases. The **full local root `npm run check` did not pass** after that lifecycle-script-disabled install because the existing `better-sqlite3` server native addon was not compiled; this is an isolated test environment limitation, not evidence the server suite passed. The original CI's `server-web`, `native-source`, `native-linux` and `native-android` jobs remain unchanged and must be independently verified on the exact PR head. Native Flutter checks validate existing code only, **not** that it has adopted these web CSS tokens.

**Executed local real-browser acceptance:** An opt-in [source-controlled Chromium runner](../apps/web/qa/browser-acceptance.mjs) and the rebuilt React bundle exercised **900×800 light desktop, 390×844 dark mobile, and 320×760 light compact** in genuine Chromium, all **3/3 PASS**. A strict intercepted in-memory API returned only `GET /api/me` (unauthorized) and `GET /api/config` (bootstrap unavailable) to produce the blank synthetic login; **all off-origin requests and unknown API calls were rejected**. The runner checked the `Welcome back` and invite/signup toggle, native username focus, official computed canvas/brand roles, browser theme-color metadata, automatic OS appearance changes in both directions, panel geometry, and document containment, with no uncaught JS errors.

**Visual defect found and corrected:** On the first 900px desktop screenshot, a previously unstyled `auth-ambient` placeholder participated in CSS grid placement, forcing the login into the second column and the branded panel onto a new row (900×1242 page). Making this decorative element absolutely positioned and noninteractive restored the intended **login-left / branded-panel-right composition** at **900×800**. The real Chromium regression now explicitly asserts the branded panel sits beside the login, not below. Desktop, 390px mobile and 320px compact captures were visually inspected after retesting. Representative synthetic evidence:
- [Corrected 900px light desktop login](evidence/teams-chromium-desktop-light.png)
- [390px dark mobile login](evidence/teams-chromium-mobile-dark.png)
- [320px light compact login](evidence/teams-chromium-compact-light.png)

The new independent `web-browser-acceptance` GitHub job installs pinned Playwright Core 1.64.1 and Chromium **inside its ephemeral runner only**, builds Teams' real React web bundle and runs the same local-only acceptance, preserving synthetic screenshots as a seven-day workflow artifact. Its **exact-head hosted result must be read back before merge**. No browser is installed by the source-controlled runner, no real account or messaging data was used, and none of this certifies authentication/identity, actual message workflows, native clients or supported-browser versions.

## Open acceptance

Human Orca/TalkBack/NVDA/VoiceOver, long localized strings/RTL, true supported Firefox/Safari zoom and official Apple Safari, founder premium visual signoff, native Android/Flutter and Linux screens, real Teams login/session/channel/message flow, backend synchronization/privacy/security and recovery, service release and deployment all **remain unverified**. GoreeCloud UI provides visual semantics only; GoreeShield privacy, Wardveil cybersecurity, Mesh connectivity and GoreeCloud Identity remain separately governed.

Rollback requires normal protected-source revert. No production state or existing credential/session data is migrated by this work.
