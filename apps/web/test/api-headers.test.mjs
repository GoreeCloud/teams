import test from "node:test";
import assert from "node:assert/strict";
import {api} from "../src/api.ts";

test("no-body mutations omit JSON content type; JSON payloads retain it",async t=>{
  const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  const requests=[];
  globalThis.fetch=async(url,options)=>{
    requests.push({url,options});
    return {ok:true,json:async()=>({ok:true})};
  };
  for(const endpoint of ["/messages/synthetic/save","/messages/synthetic/pin","/auth/logout"]){
    const answer=await api(endpoint,"POST");
    assert.deepEqual(answer,{ok:true});
  }
  assert.equal(requests.length,3);
  for(const {url,options} of requests){
    assert.ok(url.startsWith("/api/"));
    assert.equal(options.method,"POST");
    assert.equal(options.credentials,"same-origin");
    assert.equal(options.headers,undefined,
      "Fastify must not see application/json without a JSON document");
    assert.equal(options.body,undefined);
  }
  requests.length=0;
  await api("/auth/register","POST",{username:"synthetic"});
  assert.deepEqual(requests[0].options.headers,{"content-type":"application/json"});
  assert.equal(requests[0].options.body,'{"username":"synthetic"}');
  requests.length=0;
  await api("/workspaces");
  assert.equal(requests[0].options.method,"GET");
  assert.equal(requests[0].options.headers,undefined);
  assert.equal(requests[0].options.body,undefined);
});
