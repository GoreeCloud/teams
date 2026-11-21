import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { once } from "node:events";
import { createServer } from "../src/server.mjs";

const call = (app, method, url, token, payload) => app.inject({
  method, url, payload,
  headers: token ? { authorization: "Bearer " + token } : {}
});

async function setup(app) {
  const registered = await call(app, "POST", "/api/auth/register", null, {
    username: "pins_owner", displayName: "Owner",
    password: "synthetic-pins-password-12345"
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const owner = registered.json().accessToken;
  const workspace = (await call(app,"GET","/api/workspaces",owner)).json()[0];
  const add = async username => {
    const code = await call(app,"POST","/api/workspaces/"+workspace.id+"/invites",owner,{});
    const registered = await call(app,"POST","/api/auth/register",null,{
      username,displayName:username,password:"synthetic-pins-password-12345",
      invite:code.json().invite
    });
    assert.equal(registered.statusCode,201,registered.body);
    return registered.json().accessToken;
  };
  const member = await add("pins_member"), outsider = await add("pins_outsider");
  const channels = (await call(app,"GET","/api/workspaces/"+workspace.id+"/channels",owner)).json();
  return {owner,member,outsider,workspace,general:channels.find(ch=>ch.name==="general")};
}
const putMessage = async (app, channel, token, body, parentId) => {
  const result=await call(app,"POST","/api/channels/"+channel.id+"/messages",token,
    {body,...(parentId?{parentId}:{})});
  assert.equal(result.statusCode,201,result.body);
  return result.json();
};

test("pins obey viewer permissions, author/admin unpin policy, and message deletion lifecycle",
async t => {
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async ()=>app.close());
  const {owner,member,outsider,workspace,general}=await setup(app);
  const first=await putMessage(app,general,owner,"Pin this team decision");
  const peer=(await call(app,"GET","/api/me",member)).json().user;
  const pin=await call(app,"POST","/api/messages/"+first.id+"/pin",member,{});
  assert.equal(pin.statusCode,200,pin.body);
  assert.equal(pin.json().pinnedBy,peer.id);
  assert.ok(pin.json().pinnedAt);
  assert.equal((await call(app,"POST","/api/messages/"+first.id+"/pin",member,{})).json().pinnedAt,pin.json().pinnedAt,
    "pinning is idempotent");
  const list=await call(app,"GET","/api/channels/"+general.id+"/pins",outsider);
  assert.equal(list.statusCode,200);
  assert.deepEqual(list.json().map(x=>x.id),[first.id]);
  assert.equal((await call(app,"DELETE","/api/messages/"+first.id+"/pin",outsider)).statusCode,403);
  const removed=await call(app,"DELETE","/api/messages/"+first.id+"/pin",owner);
  assert.equal(removed.statusCode,200,removed.body);
  assert.equal(removed.json().pinnedBy,null);
  assert.deepEqual((await call(app,"GET","/api/channels/"+general.id+"/pins",member)).json(),[]);
  assert.equal((await call(app,"DELETE","/api/messages/"+first.id+"/pin",owner)).statusCode,404);

  const privateChannel=await call(app,"POST","/api/workspaces/"+workspace.id+"/channels",owner,
    {name:"strict-pins",isPrivate:true});
  assert.equal(privateChannel.statusCode,201);
  const secret=await putMessage(app,privateChannel.json(),owner,"Secret internal pin");
  assert.equal((await call(app,"GET","/api/channels/"+privateChannel.json().id+"/pins",member)).statusCode,404);
  assert.equal((await call(app,"POST","/api/messages/"+secret.id+"/pin",member,{})).statusCode,404);
  assert.equal((await call(app,"POST","/api/channels/"+privateChannel.json().id+"/members",owner,
    {username:"pins_member"})).statusCode,200);
  assert.equal((await call(app,"POST","/api/messages/"+secret.id+"/pin",member,{})).statusCode,200);
  assert.equal((await call(app,"GET","/api/channels/"+privateChannel.json().id+"/pins",outsider)).statusCode,404);
  assert.equal((await call(app,"POST","/api/messages/"+secret.id+"/pin",outsider,{})).statusCode,404);
  assert.equal((await call(app,"GET","/api/channels/"+privateChannel.json().id+"/pins",member)).json().length,1);
  const deleted=await call(app,"DELETE","/api/messages/"+secret.id,owner);
  assert.equal(deleted.statusCode,200,deleted.body);
  assert.equal(deleted.json().pinnedBy,null);
  assert.equal((await call(app,"GET","/api/channels/"+privateChannel.json().id+"/pins",member)).json().length,0);
  assert.equal((await call(app,"POST","/api/messages/"+secret.id+"/pin",member,{})).statusCode,409);
});

test("pins are capped at 50 per channel without a bypass through duplicate pin requests",
async t => {
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async ()=>app.close());
  const {owner,general}=await setup(app);
  const pinned=[];
  for(let i=0;i<50;i++){
    const msg=await putMessage(app,general,owner,"Synthetic note "+i);
    pinned.push(msg);
    assert.equal((await call(app,"POST","/api/messages/"+msg.id+"/pin",owner,{})).statusCode,200);
  }
  const extra=await putMessage(app,general,owner,"Overflow note");
  assert.equal((await call(app,"POST","/api/messages/"+extra.id+"/pin",owner,{})).statusCode,409);
  assert.equal((await call(app,"POST","/api/messages/"+pinned[0].id+"/pin",owner,{})).statusCode,200);
  assert.equal((await call(app,"GET","/api/channels/"+general.id+"/pins",owner)).json().length,50);
  assert.equal((await call(app,"DELETE","/api/messages/"+pinned[0].id+"/pin",owner)).statusCode,200);
  assert.equal((await call(app,"POST","/api/messages/"+extra.id+"/pin",owner,{})).statusCode,200);
  assert.equal((await call(app,"GET","/api/channels/"+general.id+"/pins",owner)).json().length,50);
});

test("pin events for private channels never reach unrelated workspace sockets", async t => {
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  const sockets=[];
  t.after(async()=>{
    for(const socket of sockets)socket.terminate();
    await app.close();
  });
  const {owner,member,outsider,workspace}=await setup(app);
  const created=await call(app,"POST","/api/workspaces/"+workspace.id+"/channels",owner,
    {name:"private-pin-notices",isPrivate:true});
  assert.equal(created.statusCode,201);
  const channel=created.json();
  const msg=await putMessage(app,channel,owner,"Plan confidential");
  assert.equal((await call(app,"POST","/api/channels/"+channel.id+"/members",owner,
    {username:"pins_member"})).statusCode,200);
  await app.listen({host:"127.0.0.1",port:0});
  const {port}=app.server.address();
  const observed=[[],[],[]];
  async function watch(token,out){
    const socket=new WebSocket("ws://127.0.0.1:"+port+"/api/events",{
      headers:{authorization:"Bearer "+token}
    });
    sockets.push(socket);
    socket.on("message",data=>{
      try {out.push(JSON.parse(data.toString()));} catch{/*wire decode*/}
    });
    await once(socket,"open");
  }
  await Promise.all([watch(owner,observed[0]),watch(member,observed[1]),watch(outsider,observed[2])]);
  assert.equal((await call(app,"POST","/api/messages/"+msg.id+"/pin",member,{})).statusCode,200);
  await new Promise(resolve=>setTimeout(resolve,140));
  assert.equal(observed[0].filter(event=>event.type==="message.updated").length,1);
  assert.equal(observed[1].filter(event=>event.type==="message.updated").length,1);
  assert.equal(observed[2].filter(event=>event.type==="message.updated").length,0);
  assert.equal(observed[1].find(event=>event.type==="message.updated").message.id,msg.id);
});


test("pins persist across restart and are removed on soft-delete without damaging messages", async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"teams-pin-persist-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,"teams.sqlite");
  const server=createServer({databaseFile:filename,bootstrapToken:"synthetic-owner-setup-test-token-at-least-32-chars"});
  const session=await call(server,"POST","/api/auth/register",null,{
    username:"pin_persist_owner",displayName:"Persistence Owner",
    password:"synthetic-persistent-pin-password-123",bootstrapToken:"synthetic-owner-setup-test-token-at-least-32-chars"
  });
  assert.equal(session.statusCode,201,session.body);
  const token=session.json().accessToken;
  const workspace=(await call(server,"GET","/api/workspaces",token)).json()[0];
  const general=(await call(server,"GET","/api/workspaces/"+workspace.id+"/channels",token))
    .json().find(channel=>channel.name==="general");
  const message=await putMessage(server,general,token,"Pinned across restart");
  const pin=await call(server,"POST","/api/messages/"+message.id+"/pin",token,{});
  assert.equal(pin.statusCode,200);
  const stamp=pin.json().pinnedAt;
  await server.close();

  const reopened=createServer({databaseFile:filename});
  t.after(async()=>reopened.close());
  const pins=await call(reopened,"GET","/api/channels/"+general.id+"/pins",token);
  assert.equal(pins.statusCode,200,pins.body);
  assert.equal(pins.json().length,1);
  assert.equal(pins.json()[0].pinnedAt,stamp);
  assert.equal(pins.json()[0].body,"Pinned across restart");
  const removed=await call(reopened,"DELETE","/api/messages/"+message.id,token);
  assert.equal(removed.statusCode,200,removed.body);
  assert.equal(removed.json().pinnedAt,null);
  assert.equal((await call(reopened,"GET","/api/channels/"+general.id+"/pins",token)).json().length,0);
  const deleted=await call(reopened,"GET","/api/channels/"+general.id+"/messages",token);
  assert.equal(deleted.json().find(item=>item.id===message.id).body,"");
});
