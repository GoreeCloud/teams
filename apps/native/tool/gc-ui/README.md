# GoreeCloud UI token snapshot for Teams Flutter

**Development-only alpha source snapshot.** The contents of this folder are
read-only data copied from the first-party, MIT-licensed GoreeCloud UI
authority repository, not a second branding authority or published package.

- Canonical source: `GoreeCloud/gc-ui/tokens/gc.tokens.json`
- Verified commit: `5625121316230d78dd40a6e41a0671a250cb873b`
- Token SHA-256: `d3226033ba50d601fcabbb01eadc2fdff8eb1be6cde6f6ebe8b0b47f1041e8e0`
- License: MIT; original license text is retained as `LICENSE`
- Snapshot: `gc.tokens.json`
- Consumer: Teams native Flutter Android and Linux via
  `../lib/generated/gc_ui_tokens.g.dart`
- Stage: design-system alpha; colors remain provisional until visual/device
  acceptance.

Regenerate only after independently reviewing authorized upstream changes:

```bash
node apps/native/tool/update_gc_ui_tokens.mjs --write
node apps/native/tool/update_gc_ui_tokens.mjs --check
node --test apps/native/tool/gc_ui_tokens.test.mjs
```

The generator never downloads source or invents colors. It validates the
canonical schema and the selected semantic light/dark and Iris roles,
producing a deterministic Dart library. The root `npm run check` gate
detects stale output, unexpected upstream changes, or divergence from the
source-pinned React web semantic colors. Do not silently update this
snapshot to an unreviewed commit.

The existing approved Flutter Linux primary framework remains in place. The
native Flutter UI uses Material 3 and canonical GoreeCloud semantic colors;
it does **not** by itself constitute Android Material 3 Expressive runtime
adoption, Compose Multiplatform implementation, physical-device acceptance,
or an approved final brand release. Android-specific Expressive interaction
and accessibility review remain separate milestones.
