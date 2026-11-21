import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { createServer } from "../src/server.mjs";

const call = (app, method, route, token, payload) => app.inject({
  method, url: route, payload, headers: token ? {authorization:"Bearer "+token} : {}
});

async function fixture(app) {
  const initial=await call(app,"POST","/api/auth/register",null,{
    username:"saved_owner",displayName:"Saved Owner",password:"synthetic-saved-test-password-123"
  });
  assert.equal(initial.statusCode,201,initial.body);
  const owner=initial.json().accessToken;
  const workspace=(await call(app,"GET","/api/workspaces",owner)).json()[0];
  const member=async name=>{
    const invite=await call(app,"POST","/api/workspaces/"+workspace.id+"/invites",owner,{});
    assert.equal(invite.statusCode,201,invite.body);
    const result=await call(app,"POST","/api/auth/register",null,{
      username:name,displayName:name,password:"synthetic-saved-test-password-123",
      invite:invite.json().invite
    });
    assert.equal(result.statusCode,201,result.body);
    return result.json().accessToken;
  };
  const bob=await member("saved_bob"),carol=await member("saved_carol");
  const channels=(await call(app,"GET","/api/workspaces/"+workspace.id+"/channels",owner)).json();
  const general=channels.find(ch=>ch.name==="general");
  const privateResponse=await call(app,"POST","/api/workspaces/"+workspace.id+"/channels",
    owner,{name:"saved-private",isPrivate:true});
  assert.equal(privateResponse.statusCode,201,privateResponse.body);
  const privateChannel=privateResponse.json();
  assert.equal((await call(app,"POST","/api/channels/"+privateChannel.id+"/members",
    owner,{username:"saved_bob"})).statusCode,200);
  return {owner,bob,carol,workspace,general,privateChannel};
}
const post=(app,channel,token,body,parentId) =>
  call(app,"POST","/api/channels/"+channel.id+"/messages",token,{
    body,...(parentId?{parentId}:{})
  });
const list=(app,workspace,token,before) => call(app,"GET",
  "/api/workspaces/"+workspace.id+"/saved"+(before?"?before="+before:""),token);
const ids=(app,workspace,token) =>
  call(app,"GET","/api/workspaces/"+workspace.id+"/saved-ids",token);
const save=(app,token,id) => call(app,"POST","/api/messages/"+id+"/save",token,{});
const unsave=(app,token,id) => call(app,"DELETE","/api/messages/"+id+"/save",token);

test("saved messages are private to the account, permission-checked and reversible",async t=>{
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async()=>app.close());
  const {owner,bob,carol,workspace,general,privateChannel}=await fixture(app);
  const pub=await post(app,general,bob,"A public note");
  const secret=await post(app,privateChannel,bob,"A restricted note");
  assert.equal(pub.statusCode,201);
  assert.equal(secret.statusCode,201);
  const privateId=secret.json().id,publicId=pub.json().id;

  assert.equal((await ids(app,workspace,null)).statusCode,401);
  assert.deepEqual((await ids(app,workspace,owner)).json(),[]);
  assert.equal((await save(app,carol,privateId)).statusCode,404);
  assert.equal((await save(app,null,privateId)).statusCode,401);
  assert.equal((await save(app,owner,privateId)).statusCode,200);
  assert.equal((await save(app,owner,privateId)).statusCode,200,"saving twice is idempotent");
  assert.equal((await save(app,bob,privateId)).statusCode,200);
  assert.equal((await save(app,owner,publicId)).statusCode,200);
  assert.equal((await list(app,workspace,carol)).json().length,0);
  assert.equal((await ids(app,workspace,carol)).json().length,0);
  const saved=(await list(app,workspace,owner)).json();
  assert.equal(saved.length,2);
  assert.ok(saved.some(x=>x.message.body==="A restricted note"));
  assert.ok(saved.some(x=>x.message.body==="A public note"));
  assert.ok(saved.every(x=>typeof x.savedAt==="string" && typeof x.channelName==="string"));
  assert.ok(saved.every(x=>x.message.authorId && x.message.channelId));
  assert.ok(saved.every(x=>!Object.hasOwn(x,"tokenHash") && !Object.hasOwn(x,"savedBy")));
  assert.deepEqual((await ids(app,workspace,owner)).json().sort(),
    [privateId,publicId].sort());
  assert.equal((await list(app,workspace,owner,"not-a-cursor")).statusCode,400);
  assert.equal((await list(app,workspace,carol,privateId)).statusCode,404);
  assert.equal((await list(app,workspace,owner,secret.json().id)).statusCode,200);

  assert.equal((await unsave(app,carol,privateId)).statusCode,200,
    "idempotent unsave does not leak private message existence");
  assert.equal((await unsave(app,owner,privateId)).statusCode,200);
  assert.deepEqual((await ids(app,workspace,owner)).json(),[publicId]);
  assert.equal((await unsave(app,owner,privateId)).statusCode,200);
  assert.equal((await save(app,owner,privateId)).statusCode,200);
  const members=(await call(app,"GET","/api/channels/"+privateChannel.id+"/members",owner)).json();
  const bobId=members.find(member=>member.username==="saved_bob").id;
  assert.equal((await call(app,"DELETE",
    "/api/channels/"+privateChannel.id+"/members/"+bobId,owner)).statusCode,200);
  assert.equal((await save(app,bob,privateId)).statusCode,404);
  assert.deepEqual((await ids(app,workspace,bob)).json(),[]);
  assert.deepEqual((await list(app,workspace,bob)).json(),[]);
  assert.equal((await call(app,"POST","/api/channels/"+privateChannel.id+"/members",
    owner,{username:"saved_bob"})).statusCode,200);
  assert.deepEqual((await ids(app,workspace,bob)).json(),[],
    "revoked private saves stay purged even if channel membership is restored");
  assert.equal((await unsave(app,bob,privateId)).statusCode,200);
  assert.equal((await call(app,"DELETE","/api/messages/"+privateId,owner)).statusCode,200);
  assert.equal((await save(app,owner,privateId)).statusCode,404);
  assert.deepEqual((await ids(app,workspace,owner)).json(),[publicId]);
  assert.equal((await list(app,workspace,owner,privateId)).statusCode,404,
    "deleted saves cannot be used as pagination cursors");
});

test("saved list uses bounded keyset pagination with exact user and workspace authorization",async t=>{
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async()=>app.close());
  const {owner,bob,workspace,general}=await fixture(app);
  const route="/api/workspaces/"+workspace.id+"/saved";
  for (const bad of ["0","-1","101","Infinity","NaN","3.5"]) {
    assert.equal((await call(app,"GET",route+"?limit="+bad,owner)).statusCode,400);
  }
  const count=105;
  for(let index=0;index<count;index++){
    const sent=await post(app,general,bob,"Synthetic saved history "+index);
    assert.equal(sent.statusCode,201,sent.body);
    assert.equal((await save(app,owner,sent.json().id)).statusCode,200);
  }
  const first=await call(app,"GET",route+"?limit=50",owner);
  assert.equal(first.statusCode,200,first.body);
  const page1=first.json();
  assert.equal(page1.length,50);
  const second=await call(app,"GET",route+"?limit=50&before="+page1.at(-1).message.id,owner);
  assert.equal(second.statusCode,200,second.body);
  assert.equal(second.json().length,50);
  const third=await call(app,"GET",route+"?limit=50&before="+second.json().at(-1).message.id,owner);
  assert.equal(third.statusCode,200,third.body);
  assert.equal(third.json().length,5);
  const all=[...page1,...second.json(),...third.json()];
  assert.equal(new Set(all.map(row=>row.message.id)).size,count);
  assert.equal((await ids(app,workspace,owner)).json().length,count);
  assert.equal((await list(app,workspace,bob,page1.at(-1).message.id)).statusCode,404,
    "another account cannot page using this account's cursor");
  assert.equal((await list(app,workspace,bob)).json().length,0);
});

test("save state events are self-scoped across sessions, never broadcast to teammates",async t=>{
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  const sockets=[];
  t.after(async()=>{for(const socket of sockets)socket.terminate();await app.close();});
  const {owner,bob,general,workspace}=await fixture(app);
  const secondLogin=await call(app,"POST","/api/auth/login",null,{
    username:"saved_owner",password:"synthetic-saved-test-password-123"
  });
  assert.equal(secondLogin.statusCode,200);
  const second=secondLogin.json().accessToken;
  const original=await post(app,general,bob,"Cross-session saved changes");
  assert.equal(original.statusCode,201);
  await app.listen({host:"127.0.0.1",port:0});
  const port=app.server.address().port;
  const events=[[],[],[]];
  async function connect(token,target){
    const socket=new WebSocket("ws://127.0.0.1:"+port+"/api/events",
      {headers:{authorization:"Bearer "+token}});
    sockets.push(socket);
    socket.on("message",value=>{
      try {target.push(JSON.parse(value.toString()));} catch { /* ignore malformed */ }
    });
    await once(socket,"open");
  }
  await Promise.all([
    connect(owner,events[0]),connect(second,events[1]),connect(bob,events[2])
  ]);
  assert.equal((await save(app,owner,original.json().id)).statusCode,200);
  await new Promise(resolve=>setTimeout(resolve,80));
  for(const own of events.slice(0,2)){
    const updates=own.filter(e=>e.type==="saved.changed");
    assert.equal(updates.length,1);
    assert.equal(updates[0].messageId,original.json().id);
    assert.equal(updates[0].workspaceId,workspace.id);
    assert.equal(updates[0].saved,true);
    assert.equal(updates[0].message,undefined);
  }
  assert.equal(events[2].some(e=>e.type==="saved.changed"),false);
  assert.equal((await unsave(app,bob,original.json().id)).statusCode,200);
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(events[2].some(e=>e.type==="saved.changed"),false,
    "unknown bookmarks cannot reveal another user's message through events");
  assert.equal((await unsave(app,second,original.json().id)).statusCode,200);
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(events[0].filter(e=>e.type==="saved.changed"&&e.saved===false).length,1);
  assert.equal(events[2].some(e=>e.type==="saved.changed"),false);
});
