import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { createServer } from "../src/server.mjs";

const call = (app, method, route, token, payload) => app.inject({
  method, url: route, payload, headers: token ? { authorization: "Bearer " + token } : {}
});
const sleep = (ms = 3) => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(app) {
  const ownerResponse = await call(app, "POST", "/api/auth/register", null, {
    username: "unread_owner", displayName: "Owner", password: "synthetic-test-password-12345"
  });
  assert.equal(ownerResponse.statusCode, 201);
  const owner = ownerResponse.json().accessToken;
  const workspace = (await call(app, "GET", "/api/workspaces", owner)).json()[0];
  const other = async name => {
    const invite = await call(app,"POST", "/api/workspaces/" + workspace.id + "/invites",owner,{});
    assert.equal(invite.statusCode,201);
    const created = await call(app,"POST","/api/auth/register",null,{
      username:name,displayName:name,password:"synthetic-test-password-12345",
      invite:invite.json().invite
    });
    assert.equal(created.statusCode,201,created.body);
    return created.json().accessToken;
  };
  const bob = await other("unread_bob");
  const carol = await other("unread_carol");
  const general = (await call(app,"GET","/api/workspaces/"+workspace.id+"/channels",owner))
    .json().find(ch=>ch.name==="general");
  return {owner,bob,carol,workspace,general};
}
const root = (app, ch, token, body, parentId) =>
  call(app,"POST","/api/channels/"+ch.id+"/messages",token,{body,...(parentId?{parentId}:{})});
const summary = async(app,workspace,token) => {
  const response = await call(app,"GET","/api/workspaces/"+workspace.id+"/unread",token);
  assert.equal(response.statusCode,200,response.body);
  return Object.fromEntries(response.json().map(ch=>[ch.channelId,ch.count]));
};
const read = (app,ch,token,messageId) =>
  call(app,"POST","/api/channels/"+ch.id+"/read",token,{messageId});

test("unread counts exclude own messages and replies, and read cursors cannot regress",async t=>{
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async()=>app.close());
  const {owner,bob,carol,workspace,general}=await fixture(app);
  assert.equal((await call(app,"GET","/api/workspaces/"+workspace.id+"/unread",null)).statusCode,401);
  const one=await root(app,general,bob,"first root");
  await sleep();
  const two=await root(app,general,bob,"second root");
  await sleep();
  const three=await root(app,general,bob,"third root");
  assert.equal(one.statusCode,201);assert.equal(two.statusCode,201);assert.equal(three.statusCode,201);
  const reply=await root(app,general,bob,"thread detail",one.json().id);
  assert.equal(reply.statusCode,201);
  assert.equal((await summary(app,workspace,owner))[general.id],3);
  assert.equal((await summary(app,workspace,carol))[general.id],3);
  assert.equal((await summary(app,workspace,bob))[general.id],undefined);
  assert.equal((await read(app,general,owner,reply.json().id)).statusCode,404,
    "reply IDs cannot be used as root read cursors");
  assert.equal((await read(app,general,owner,"invalid")).statusCode,400);
  assert.equal((await read(app,general,null,one.json().id)).statusCode,401);
  assert.equal((await read(app,general,owner,two.json().id)).statusCode,200);
  assert.equal((await summary(app,workspace,owner))[general.id],1);
  assert.equal((await read(app,general,owner,one.json().id)).statusCode,200);
  assert.equal((await summary(app,workspace,owner))[general.id],1,
    "old request must never make a channel unread again");
  assert.equal((await read(app,general,owner,three.json().id)).statusCode,200);
  assert.equal((await summary(app,workspace,owner))[general.id],undefined);
  const own=await root(app,general,owner,"author wrote this");
  assert.equal(own.statusCode,201);
  assert.equal((await summary(app,workspace,owner))[general.id],undefined);
  assert.equal((await summary(app,workspace,carol))[general.id],4);
  const newer=await root(app,general,bob,"new unseen root");
  assert.equal(newer.statusCode,201);
  assert.equal((await summary(app,workspace,owner))[general.id],1);
  assert.equal((await summary(app,workspace,carol))[general.id],5);
});

test("unread summary is isolated to authorized channels, including DM scopes",async t=>{
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async()=>app.close());
  const {owner,bob,carol,workspace,general}=await fixture(app);
  const p=await call(app,"POST","/api/workspaces/"+workspace.id+"/channels",owner,{
    name:"unread-secret",isPrivate:true
  });
  assert.equal(p.statusCode,201,p.body);
  const secret=p.json();
  await call(app,"POST","/api/channels/"+secret.id+"/members",owner,{username:"unread_bob"});
  const message=await root(app,secret,bob,"private unseen");
  assert.equal(message.statusCode,201);
  assert.equal((await summary(app,workspace,owner))[secret.id],1);
  assert.equal((await summary(app,workspace,carol))[secret.id],undefined);
  assert.equal((await read(app,secret,carol,message.json().id)).statusCode,404);
  assert.equal((await read(app,general,owner,message.json().id)).statusCode,404);
  const dm=await call(app,"POST","/api/workspaces/"+workspace.id+"/dms",owner,{
    username:"unread_bob"
  });
  assert.equal(dm.statusCode,200,dm.body);
  const conversation=dm.json();
  const dmMessage=await root(app,conversation,bob,"direct unseen");
  assert.equal(dmMessage.statusCode,201);
  assert.equal((await summary(app,workspace,owner))[conversation.id],1);
  assert.equal((await summary(app,workspace,carol))[conversation.id],undefined);
  assert.equal((await read(app,conversation,carol,dmMessage.json().id)).statusCode,404);
  const members=(await call(app,"GET","/api/channels/"+secret.id+"/members",owner)).json();
  const bobId=members.find(member=>member.username==="unread_bob").id;
  assert.equal((await call(app,"DELETE",
    "/api/channels/"+secret.id+"/members/"+bobId,owner)).statusCode,200);
  assert.equal((await summary(app,workspace,bob))[secret.id],undefined);
  assert.equal((await read(app,secret,bob,message.json().id)).statusCode,404);
});

test("read acknowledgements fan out to own sessions, not other accounts",async t=>{
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  const sockets=[];
  t.after(async()=>{for(const socket of sockets)socket.terminate();await app.close();});
  const {owner,bob,general}=await fixture(app);
  const message=await root(app,general,bob,"notify read event");
  assert.equal(message.statusCode,201);
  await app.listen({host:"127.0.0.1",port:0});
  const port=app.server.address().port;
  const events={owner:[],bob:[]};
  const connect=async(token,buffer)=>{
    const socket=new WebSocket("ws://127.0.0.1:"+port+"/api/events",{
      headers:{authorization:"Bearer "+token}
    });
    sockets.push(socket);
    socket.on("message",data=>{try{buffer.push(JSON.parse(data.toString()));}catch{}});
    await once(socket,"open");
  };
  await Promise.all([connect(owner,events.owner),connect(bob,events.bob)]);
  const acknowledged=await read(app,general,owner,message.json().id);
  assert.equal(acknowledged.statusCode,200,acknowledged.body);
  await sleep(80);
  assert.equal(events.owner.filter(e=>e.type==="unread.updated"&&e.channelId===general.id).length,1);
  assert.equal(events.bob.filter(e=>e.type==="unread.updated").length,0);
});
