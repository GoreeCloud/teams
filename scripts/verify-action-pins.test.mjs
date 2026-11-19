import test from "node:test";
import assert from "node:assert/strict";
import { verifyActionSource, verifyWorkflows } from "./verify-action-pins.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const safe = "11d5960a326750d5838078e36cf38b85af677262";

test("checked-in workflows use only reviewed actions pinned to immutable SHAs", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = verifyWorkflows(path.join(root, ".github", "workflows"));
  assert.ok(result.workflows >= 1);
  assert.ok(result.actions >= 5);
});

test("workflow verifier accepts reviewed SHA pins, not tags or arbitrary sources", () => {
  assert.equal(verifyActionSource("  - uses: actions/checkout@" + safe + " # v4\n"), 1);
  assert.throws(() => verifyActionSource("  - uses: actions/checkout@v4"), /full 40-character/);
  assert.throws(() => verifyActionSource("    uses: subosito/flutter-action@v2"), /full 40-character/);
  assert.throws(() => verifyActionSource("  - uses: evil/vendor@" + safe), /unreviewed action/);
  assert.throws(() => verifyActionSource("  - uses: docker://evil/image:latest"), /full 40-character/);
  assert.throws(() => verifyActionSource("  - uses: actions/checkout@\u0024{{ secrets.UNTRUSTED }}"), /full 40-character/);
});
