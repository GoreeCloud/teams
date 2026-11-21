import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.mjs";

const PASSWORD = "synthetic-registration-admission-password-12345";
const inject = (app, username, invite, spoof) => app.inject({
  method: "POST",
  url: "/api/auth/register",
  headers: spoof ? {"x-forwarded-for":spoof} : {},
  payload: {username, displayName:"Synthetic Test Account", password:PASSWORD,
    ...(invite===undefined ? {} : {invite})}
});
const createOwner = async app => {
  const owner = await inject(app,"admission_owner");
  assert.equal(owner.statusCode,201,owner.body);
  return owner.json().accessToken;
};
const createInvite = async (app,owner) => {
  const workspaces = await app.inject({method:"GET",url:"/api/workspaces",
    headers:{authorization:"Bearer "+owner}});
  assert.equal(workspaces.statusCode,200,workspaces.body);
  const response = await app.inject({method:"POST",
    url:"/api/workspaces/"+workspaces.json()[0].id+"/invites",
    headers:{authorization:"Bearer "+owner},payload:{}});
  assert.equal(response.statusCode,201,response.body);
  return response.json().invite;
};

test("invitation guessing is bounded, forged forwarded IP headers cannot evade cap", async t => {
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async()=>app.close());
  const owner=await createOwner(app);
  const validInvite=await createInvite(app,owner);
  for(let i=0;i<10;i++) {
    const denied=await inject(app,"guest_guess_"+i,"invalid-invite", "198.51.100."+(i+1));
    assert.equal(denied.statusCode,403,denied.body);
    assert.deepEqual(denied.json(),{error:"Registration requires an invitation"});
  }
  const blocked=await inject(app,"guest_ready",validInvite,"203.0.113.43");
  assert.equal(blocked.statusCode,429,blocked.body);
  assert.deepEqual(blocked.json(),{error:"Too many attempts. Try again later."});
  // A registration attack must not consume the separate login failure budget.
  const login=await app.inject({method:"POST",url:"/api/auth/login",
    payload:{username:"admission_owner",password:PASSWORD}});
  assert.equal(login.statusCode,200,login.body);
  const reused=await app.inject({method:"POST",url:"/api/auth/register",
    payload:{username:"guest_unknown",displayName:"User",password:PASSWORD,invite:validInvite}});
  assert.equal(reused.statusCode,429);
});

test("successful invited registration releases the registration failure history", async t => {
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async()=>app.close());
  const owner=await createOwner(app);
  const invite=await createInvite(app,owner);
  for(let i=0;i<9;i++) {
    const denied=await inject(app,"candidate_before_"+i,"incorrect");
    assert.equal(denied.statusCode,403,denied.body);
  }
  const joined=await inject(app,"guest_allowed",invite);
  assert.equal(joined.statusCode,201,joined.body);
  for(let i=0;i<10;i++) {
    const denied=await inject(app,"candidate_after_"+i,"incorrect");
    assert.equal(denied.statusCode,403,denied.body);
  }
  const exhausted=await inject(app,"blocked_again","incorrect");
  assert.equal(exhausted.statusCode,429);
});

test("invalid bootstrap requests consume admission budget without creating an owner",async t=>{
  const app=createServer({allowUnsafeMemoryBootstrap:true});
  t.after(async()=>app.close());
  for(let i=0;i<10;i++){
    const result=await app.inject({method:"POST",url:"/api/auth/register",
      headers:{"x-forwarded-for":"192.0.2."+(i+1)},
      payload:{username:"x",displayName:"n",password:"short"}});
    assert.equal(result.statusCode,400,result.body);
  }
  const owner=await inject(app,"admission_owner");
  assert.equal(owner.statusCode,429);
  const config=await app.inject({method:"GET",url:"/api/config"});
  assert.equal(config.json().bootstrapAvailable,true);
});
