import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
const root = new URL("../", import.meta.url);
const read = relative => readFileSync(new URL(relative, root), "utf8");
const provenance = JSON.parse(read("src/vendor/gc-ui/provenance.json"));

test("Teams web pins canonical first-party UI alpha CSS and MIT attribution",()=>{
  assert.equal(provenance.upstream, "https://github.com/GoreeCloud/gc-ui");
  assert.equal(provenance.sourceCommit,"2537a80e39941f392d2e13e5177fe87ee8499438");
  assert.equal(provenance.license,"MIT");
  for(const [name,expected] of Object.entries(provenance.sha256)){
    assert.match(expected,/^[a-f0-9]{64}$/);
    assert.equal(createHash("sha256").update(read("src/vendor/gc-ui/"+name)).digest("hex"),expected,name);
  }
  assert.match(read("src/vendor/gc-ui/LICENSE"),/MIT License/);
  assert.doesNotMatch(read("src/vendor/gc-ui/tokens.css"),/@import\s+(?:url\()?\s*["']?https?:\/\//i);
  assert.equal(provenance.stage,"development");
});
test("React source loads pinned tokens first, preserves OS preference and theme color",()=>{
  const entry=read("src/main.tsx"), html=read("index.html");
  assert.ok(entry.indexOf('import "./vendor/gc-ui/tokens.css";')>=0);
  assert.ok(entry.indexOf('import "./vendor/gc-ui/tokens.css";')<entry.indexOf('import "./styles.css";'));
  assert.match(entry,/matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(entry,/addEventListener\("change", synchronizeAppearance\)/);
  assert.match(entry,/dataset\.gcTheme = systemAppearance\.matches \? "dark" : "light"/);
  assert.match(entry,/getPropertyValue\("--gc-canvas"\)/);
  assert.match(html,/<html lang="en" data-gc-theme="dark">/);
});
test("Teams theme aliases correspond to official canonical roles rather than copied palette",()=>{
  const css=read("src/styles.css"),source=read("src/vendor/gc-ui/tokens.css");
  const roles={
    canvas:"gc-canvas",surface:"gc-surface","surface-tonal":"gc-surface-tonal",
    text:"gc-text","text-soft":"gc-text-soft",outline:"gc-outline-soft",
    brand:"gc-brand","on-brand":"gc-on-brand","brand-subtle":"gc-brand-container",
    positive:"gc-positive"
  };
  for(const [local,canonical] of Object.entries(roles)){
    assert.ok(css.includes("--"+local+":var(--"+canonical+")"),"missing theme alias "+local);
    assert.ok(source.includes("--"+canonical+":"),"missing canonical source role "+canonical);
  }
  assert.doesNotMatch(css, /--(?:canvas|surface|surface-tonal|text|text-soft|outline|brand|on-brand|brand-subtle|positive)\s*:\s*#[0-9a-fA-F]{3,8}/);
  assert.match(css, /@media \(prefers-color-scheme:light\)/);
  assert.match(css, /:root\[data-gc-theme="light"\] \{ color-scheme:light \}/);
  assert.match(css, /\.auth-side/);
  assert.match(css, /\.message-scroll/);
  assert.match(css, /\.composer/);
});

test("Teams login ambient layer cannot consume a desktop grid column",()=>{
 const css=read("src/styles.css");
 assert.match(css,/\.auth-ambient\s*\{\s*position:absolute;\s*inset:0;\s*pointer-events:none\s*\}/);
 assert.match(css,/\.auth-layout\s*\{[^}]*grid-template-columns:\s*minmax\(440px,1fr\) minmax\(420px,1fr\)/);
 const browser=read("qa/browser-acceptance.mjs");
 assert.match(browser,/Desktop branded panel must sit to the right of login/);
});
test("independent browser acceptance is synthetic, fail closed and hosted without release side effects",()=>{
 const browser=read("qa/browser-acceptance.mjs");
 const ci=read("../../.github/workflows/ci.yml");
 assert.match(browser,/GC_TEAMS_PLAYWRIGHT_CORE/);
 assert.match(browser,/GC_TEAMS_CHROME_BIN/);
 assert.match(browser,/server\.listen\(0,"127\.0\.0\.1"/);
 assert.match(browser,/route\.abort\("blockedbyclient"\)/);
 assert.match(browser,/Synthetic browser test has no service|blocked synthetic fixture/);
 assert.match(browser,/colorScheme:other/);
 assert.match(browser,/assert\.deepEqual\(unexpected,\[\]/);
 assert.doesNotMatch(browser,/npm\s+(?:install|ci)|playwright\s+install/);
 assert.match(ci,/web-browser-acceptance:/);
 assert.match(ci,/playwright-core@1\.64\.1/);
 assert.match(ci,/node apps\/web\/qa\/browser-acceptance\.mjs/);
 assert.match(ci,/retention-days: 7/);
});
