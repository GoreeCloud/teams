#!/usr/bin/env node
/**
 * Real React + Fastify + SQLite + WebSocket browser acceptance using only
 * synthetic local data. The host's existing Chromium and Playwright Core
 * must be provided explicitly. This script NEVER downloads a browser,
 * contacts a remote service or accesses production credentials.
 */
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync,existsSync,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import {createServer} from "../../server/src/server.mjs";

for (const name of ["GC_TEAMS_PLAYWRIGHT_CORE","GC_TEAMS_CHROME_BIN"]) {
  const location = process.env[name];
  if (!location || !isAbsolute(location) || !existsSync(location) ||
      !statSync(location).isFile()) {
    throw new Error(name + " must point to an inspected existing file");
  }
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Browser acceptance never uses a production runtime");
}
const {chromium} = await import(pathToFileURL(process.env.GC_TEAMS_PLAYWRIGHT_CORE).href);
const root=mkdtempSync(join(tmpdir(),"gct-local-browser-"));
const dbFile=join(root,"synthetic.sqlite");
const setupToken=randomBytes(32).toString("hex");
const password="synthetic-browser-only-password-314159";
const message="Synthetic local-browser private fixture — message QA";
const app=createServer({databaseFile:dbFile,bootstrapToken:setupToken,serveWeb:true});
let browser;
try {
  await app.listen({host:"127.0.0.1",port:0});
  const base="http://127.0.0.1:"+app.server.address().port;
  const authorizedWebSocket="ws://127.0.0.1:"+app.server.address().port+"/api/events";
  browser=await chromium.launch({
    executablePath:process.env.GC_TEAMS_CHROME_BIN,
    headless:true,timeout:20000
  });
  const context=await browser.newContext({
    viewport:{width:1180,height:820},
    colorScheme:"light",serviceWorkers:"block",reducedMotion:"reduce"
  });
  try {
    const unexpected=[],errors=[],socketURLs=[];
    await context.route("**/*",route=>{
      const url=route.request().url();
      if(!url.startsWith(base+"/")) {
        unexpected.push("off-origin network request");
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const page=await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror",e=>errors.push(String(e).slice(0,180)));
    page.on("websocket",ws=>socketURLs.push(ws.url()));
    const initial=await page.goto(base+"/",{waitUntil:"networkidle",timeout:20000});
    assert.equal(initial?.status(),200);
    await page.getByRole("heading",{name:"Create your space."}).waitFor();
    const setupField=page.getByLabel("Owner setup token");
    assert.equal(await setupField.getAttribute("type"),"password");
    await page.getByLabel("Username").fill("browser_owner");
    await page.getByLabel("Display name").fill("Synthetic Browser Owner");
    await page.getByLabel("Password").fill(password);
    await setupField.fill(setupToken);
    assert.equal(await setupField.getAttribute("autocomplete"),"off");
    await page.getByRole("button",{name:"Create account"}).click();
    await page.getByRole("navigation",{name:"Main navigation"}).waitFor();
    const general=page.locator(".sidebar .channel-link").filter({hasText:"general"});
    await general.waitFor();
    await general.click();
    const conversation=page.getByRole("log",{name:"Messages in general"});
    await conversation.waitFor();
    const composer=page.getByRole("textbox",{name:"Write a message"});
    await composer.fill(message);
    await page.getByRole("button",{name:"Send message"}).click();
    const article=conversation.locator("article.message").filter({hasText:message});
    await article.waitFor();
    assert.equal(await article.locator(".message-body").innerText(),message);
    // Message action toolbar is hover/focus-revealed, not permanently shown.
    // Keyboard focus must expose accessible actions without a pointing device.
    await article.focus();
    assert.equal(await article.evaluate(node=>document.activeElement===node),true);
    await article.getByRole("button",{name:"Save message for later"}).waitFor();
    const saveResponse=page.waitForResponse(response=>
      response.url().includes("/api/messages/") &&
      response.url().endsWith("/save") &&
      response.request().method()==="POST");
    await article.getByRole("button",{name:"Save message for later"}).click();
    assert.equal((await saveResponse).status(),200,"real server must accept the saved-message mutation");
    // Hover-only action chrome may close after a state update; verify that
    // the saved state actually changed in the DOM, then re-focus for pinning.
    await article.locator('button[aria-label="Remove saved message"]')
      .waitFor({state:"attached"});
    await article.focus();
    await article.getByRole("button",{name:"Pin message"}).click();
    await article.locator(".pinned-indicator").waitFor();
    await page.getByRole("button",{name:"View pinned messages"}).click();
    const pins=page.getByRole("dialog",{name:"Pinned messages"});
    await pins.waitFor();
    assert.ok((await pins.innerText()).includes(message));
    await pins.getByRole("button",{name:"Close dialog"}).click();
    await page.getByRole("button",{name:"Saved messages"}).click();
    await page.getByRole("heading",{name:"Saved for later"}).waitFor();
    const saved=page.locator(".saved-card").filter({hasText:message});
    await saved.waitFor();
    await saved.getByRole("button",{name:"Open conversation"}).click();
    await conversation.locator("article.message").filter({hasText:message}).waitFor();
    await page.getByRole("button",{name:"Sign out"}).first().click();
    await page.getByRole("heading",{name:"Welcome back."}).waitFor();
    await page.getByLabel("Username").fill("browser_owner");
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button",{name:"Sign in"}).click();
    await page.getByRole("navigation",{name:"Main navigation"}).waitFor();
    await page.getByRole("button",{name:"Saved messages"}).click();
    await page.locator(".saved-card").filter({hasText:message}).waitFor();
    const unauthenticated=await fetch(base+"/api/auth/sessions");
    assert.equal(unauthenticated.status,401,"new context must not inherit session cookies");
    assert.deepEqual(errors,[],"uncaught browser errors");
    assert.deepEqual(unexpected,[],"no off-origin network access");
    assert.ok(socketURLs.length>0,"authenticated UI must establish a WebSocket");
    assert.ok(socketURLs.every(url=>url===authorizedWebSocket),
      "only authorized local WebSocket endpoints");
    console.log("Real synthetic Teams browser: owner setup, messaging, saved, pins, sign-out, sign-in and scoped transport PASS");
  }finally {
    await context.close();
  }
}finally {
  if(browser)await browser.close();
  await app.close();
  rmSync(root,{recursive:true,force:true});
}
