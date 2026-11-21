#!/usr/bin/env node
/** Opt-in real Chromium test of static Teams login with a fake, in-memory API.
 * No live account, outgoing origin or automatic browser installation. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {existsSync,statSync} from "node:fs";
import {isAbsolute,extname,resolve,sep,join} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
const root=resolve(fileURLToPath(new URL("../",import.meta.url)));
const dist=join(root,"dist");
for(const name of ["GC_TEAMS_PLAYWRIGHT_CORE","GC_TEAMS_CHROME_BIN"]){
 const value=process.env[name];
 if(!value||!isAbsolute(value)||!existsSync(value)||!statSync(value).isFile())
  throw Error(name+" must be an inspected, existing absolute file; no auto-download");
}
const screenshots=process.env.GC_TEAMS_QA_SCREENSHOTS_DIR||"";
if(screenshots&&(!isAbsolute(screenshots)||!existsSync(screenshots)||!statSync(screenshots).isDirectory()))
 throw Error("GC_TEAMS_QA_SCREENSHOTS_DIR must be an existing absolute directory");
const playwright=await import(pathToFileURL(process.env.GC_TEAMS_PLAYWRIGHT_CORE).href);
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
 ".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png"};
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=="GET"){res.writeHead(405);res.end();return;}
  const pathname=new URL(req.url,"http://127.0.0.1").pathname;
  const local=pathname==="/"?"/index.html":decodeURIComponent(pathname);
  const path=resolve(dist,"."+local);
  if(!path.startsWith(dist+sep)){res.writeHead(403);res.end();return;}
  const entry=await stat(path);
  if(!entry.isFile()){res.writeHead(404);res.end();return;}
  const data=await readFile(path);
  res.writeHead(200,{"Content-Type":mime[extname(path)]||"application/octet-stream",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(data);
 }catch{res.writeHead(404);res.end("not found");}
});
await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok);});
const base="http://127.0.0.1:"+server.address().port;
const browser=await playwright.chromium.launch({
 executablePath:process.env.GC_TEAMS_CHROME_BIN,headless:true,timeout:20000
});
const cases=[
 {name:"desktop-light",width:900,height:800,scheme:"light"},
 {name:"mobile-dark",width:390,height:844,scheme:"dark"},
 {name:"compact-light",width:320,height:760,scheme:"light"},
 {name:"owner-bootstrap",width:390,height:844,scheme:"light",bootstrap:true}
];
try{
 for(const item of cases){
  const context=await browser.newContext({viewport:{width:item.width,height:item.height},
   colorScheme:item.scheme,reducedMotion:"reduce",serviceWorkers:"block"});
  try{
   const unexpected=[],errors=[],calls=[];
   await context.route("**/*",route=>{
    const url=route.request().url();
    if(!url.startsWith(base+"/")){unexpected.push("off-origin");return route.abort("blockedbyclient");}
    const path=new URL(url).pathname;
    if(path==="/api/me"){
     calls.push(path);return route.fulfill({status:401,contentType:"application/json",body:'{"error":"synthetic not authenticated"}'});
    }
    if(path==="/api/config"){
     calls.push(path);return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({bootstrapAvailable:!!item.bootstrap,
      bootstrapTokenRequired:!!item.bootstrap})});
    }
    if(path.startsWith("/api/")){
     unexpected.push(path);return route.fulfill({status:403,contentType:"application/json",body:'{"error":"blocked synthetic fixture"}'});
    }
    return route.continue();
   });
   const page=await context.newPage();
   page.on("pageerror",e=>errors.push(String(e).slice(0,200)));
   const response=await page.goto(base+"/",{waitUntil:"networkidle",timeout:15000});
   assert.equal(response?.status(),200);
   await page.getByRole("heading",{name:item.bootstrap?"Create your space.":"Welcome back."}).waitFor();
   const getTheme=()=>page.evaluate(()=>{
    const root=document.documentElement,style=getComputedStyle(root);
    const panel=document.querySelector(".auth-card")?.getBoundingClientRect();
    const brandPanel=document.querySelector(".auth-side")?.getBoundingClientRect();
    return {scheme:root.dataset.gcTheme,canvas:style.getPropertyValue("--canvas").trim(),
      sourceCanvas:style.getPropertyValue("--gc-canvas").trim(),
      brand:style.getPropertyValue("--brand").trim(),
      sourceBrand:style.getPropertyValue("--gc-brand").trim(),
      meta:document.querySelector('meta[name="theme-color"]')?.content,
      width:innerWidth,scrollWidth:root.scrollWidth,
      panel:panel?{left:panel.left,right:panel.right}:null,
      brandPanel:brandPanel?{left:brandPanel.left,right:brandPanel.right,top:brandPanel.top}:null};
   });
   const assertTheme=(t,scheme)=>{
    assert.equal(t.scheme,scheme);
    assert.equal(t.canvas,t.sourceCanvas);
    assert.equal(t.brand,t.sourceBrand);
    assert.equal(t.meta,t.canvas);
    assert.ok(t.scrollWidth<=item.width+1,"document overflow "+JSON.stringify(t));
    assert.ok(t.panel&&t.panel.left>=-1&&t.panel.right<=item.width+1,
      "login panel overflow "+JSON.stringify(t));
    if(item.width>=900){
      assert.ok(t.brandPanel&&t.brandPanel.left>=t.panel.right-1&&
        t.brandPanel.right<=item.width+1&&t.brandPanel.top<=1,
        "Desktop branded panel must sit to the right of login, not below: "+JSON.stringify(t));
    }
   };
   assertTheme(await getTheme(),item.scheme);
   const username=page.getByRole("textbox",{name:"Username"});
   await username.focus();
   assert.equal(await username.evaluate(el=>el===document.activeElement),true);
   if(item.bootstrap){
    const secret=page.getByLabel("Owner setup token");
    await secret.waitFor();
    assert.equal(await secret.getAttribute("type"),"password");
    assert.equal(await secret.getAttribute("autocomplete"),"off");
    await secret.fill("synthetic-operator-token-never-sent-to-an-api");
    assert.equal(await secret.inputValue(),"synthetic-operator-token-never-sent-to-an-api");
    assert.ok(!(await page.locator("body").innerText()).includes("synthetic-operator-token"));
   }else{
    await page.getByRole("button",{name:"Have an invite? Create an account"}).click();
    await page.getByRole("heading",{name:"Join your team."}).waitFor();
    await page.getByRole("button",{name:"Already have an account? Sign in"}).click();
    await page.getByRole("heading",{name:"Welcome back."}).waitFor();
   }
   if(screenshots) await page.screenshot({path:join(screenshots,"teams-"+item.name+".png"),fullPage:true});
   const other=item.scheme==="dark"?"light":"dark";
   await page.emulateMedia({colorScheme:other});
   await page.waitForFunction(expected=>document.documentElement.dataset.gcTheme===expected,other);
   assertTheme(await getTheme(),other);
   await page.emulateMedia({colorScheme:item.scheme});
   await page.waitForFunction(expected=>document.documentElement.dataset.gcTheme===expected,item.scheme);
   assertTheme(await getTheme(),item.scheme);
   assert.deepEqual(errors,[]);
   assert.deepEqual(unexpected,[],"unexpected service or off-origin request");
   assert.deepEqual(calls,["/api/me","/api/config"],"unknown request or authentication");
   console.log("Chromium "+item.name+": "+(item.bootstrap?"masked private owner setup":"login + invite toggle")+", OS theme change, pinned roles, reflow PASS");
  }finally{await context.close();}
 }
}finally{
 await browser.close();
 await new Promise(done=>server.close(done));
}
