import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";

const relative=path=>fileURLToPath(new URL(path,import.meta.url));
const data=readFileSync(relative("./gc-ui/gc.tokens.json"));
const tokens=JSON.parse(data.toString("utf8"));
const css=readFileSync(relative("../../web/src/vendor/gc-ui/tokens.css"),"utf8");
const dart=readFileSync(relative("../lib/generated/gc_ui_tokens.g.dart"),"utf8");

test("vendored GoreeCloud UI snapshot is pinned, licensed and source-identical",()=>{
  const expectedSha="d3226033ba50d601fcabbb01eadc2fdff8eb1be6cde6f6ebe8b0b47f1041e8e0";
  assert.equal(createHash("sha256").update(data).digest("hex"),expectedSha);
  assert.equal(tokens.meta.name,"GoreeCloud UI");
  assert.equal(tokens.meta.license,"MIT");
  assert.match(readFileSync(relative("./gc-ui/LICENSE"),"utf8"),/MIT License/);
  assert.ok(dart.includes(expectedSha),"generated Dart must describe its exact pinned source");
  assert.ok(dart.includes("5625121316230d78dd40a6e41a0671a250cb873b"));
});

test("native generated colors agree with canonical web semantic roles and Iris accent",()=>{
  for (const scheme of ["light","dark"]) {
    for (const role of ["canvas","surface","text","outline","negative"]) {
      const hex=tokens.semantic[scheme][role];
      assert.match(hex,/^#[0-9A-F]{6}$/i);
      assert.ok(css.includes("--gc-"+role+": "+hex+";"),
        "web source missing canonical "+scheme+" "+role);
      assert.ok(dart.includes("Color(0xFF"+hex.slice(1)+")"),
        "native source missing canonical "+scheme+" "+role);
    }
    for (const role of ["brand","on-brand","brand-container","on-brand-container"]) {
      const hex=tokens.accents.iris[scheme][role];
      assert.ok(css.includes("--gc-"+role+": "+hex+";"),
        "web source missing canonical "+scheme+" Iris "+role);
      assert.ok(dart.includes("Color(0xFF"+hex.slice(1)+")"),
        "native source missing canonical "+scheme+" Iris "+role);
    }
  }
});

test("Flutter source color adapter is exactly reproducible without network access",()=>{
  const result=execFileSync(process.execPath,
    [relative("./update_gc_ui_tokens.mjs"),"--check"],
    {encoding:"utf8"});
  assert.match(result,/match pinned source/);
  const native=readFileSync(relative("../lib/main.dart"),"utf8");
  assert.match(native,/import 'generated\/gc_ui_tokens.g.dart';/);
  assert.match(native,/GcUiTokenColors.lightBrand/);
  assert.match(native,/GcUiTokenColors.darkBrand/);
});
