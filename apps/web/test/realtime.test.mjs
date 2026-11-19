import test from "node:test";
import assert from "node:assert/strict";
import { connectEvents, reconcileRecentMessages } from "../src/api.ts";

function fakeBrowser(t) {
  const keys = ["location","WebSocket","setTimeout","clearTimeout"];
  const before = Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
  t.after(() => { for(const k of keys) {
    if(before[k] === undefined) delete globalThis[k];
    else globalThis[k] = before[k];
  }});
  const timers = new Map(), sockets = [];
  let seq = 0;
  globalThis.location = {protocol:"https:",host:"teams.example.invalid"};
  globalThis.setTimeout = (callback,delay) => {
    const id = ++seq; timers.set(id,{callback,delay}); return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  class Socket {
    constructor(url) { this.url=url; sockets.push(this); }
    open() { this.onopen?.(); }
    receive(data) { this.onmessage?.({data}); }
    drop(code) { this.onclose?.({code}); }
    close() { this.drop(1000); }
  }
  globalThis.WebSocket = Socket;
  const runNext = () => {
    const [id,task] = [...timers.entries()][0];
    assert.ok(task);
    timers.delete(id); task.callback();
  };
  return {timers,sockets,runNext};
}

test("web realtime reopens after transport loss and resynchronizes only after recovery",t=>{
  const {timers,sockets,runNext}=fakeBrowser(t);
  let recovered=0,revoked=0,lost=0;const events=[];
  const stop=connectEvents(e=>events.push(e),()=>revoked++,()=>recovered++,()=>lost++);
  assert.equal(sockets.length,1);
  assert.equal(sockets[0].url,"wss://teams.example.invalid/api/events");
  sockets[0].open();
  assert.equal(recovered,0);
  sockets[0].receive('{"type":"message.created"}');
  sockets[0].receive("not-json");
  assert.deepEqual(events,[{type:"message.created"}]);
  sockets[0].drop(1006);sockets[0].drop(1006);
  assert.equal(timers.size,1);
  assert.equal(lost,1,"report only one interruption per outage");
  assert.equal([...timers.values()][0].delay,1000);
  runNext();
  assert.equal(sockets.length,2);
  sockets[1].open();
  assert.equal(recovered,1);
  assert.equal(lost,1);
  sockets[0].receive('{"type":"stale"}');
  assert.equal(events.length,1);
  sockets[1].drop(1006);
  assert.equal([...timers.values()][0].delay,1000,"open resets backoff");
  runNext();sockets[2].open();
  assert.equal(recovered,2);
  sockets[2].drop(1008);
  assert.equal(revoked,1);
  assert.equal(timers.size,0,"policy close must never reconnect");
  stop();assert.equal(revoked,1);
});

test("web realtime constructor errors retry exponentially and cleanup prevents new sockets",t=>{
  const {timers,runNext}=fakeBrowser(t);
  let attempts=0;
  globalThis.WebSocket = class {
    constructor(){attempts++;throw new Error("synthetic network down");}
  };
  const stop=connectEvents(()=>{});
  assert.equal(attempts,1);
  assert.equal([...timers.values()][0].delay,1000);
  runNext();assert.equal(attempts,2);
  assert.equal([...timers.values()][0].delay,2000);
  runNext();assert.equal(attempts,3);
  assert.equal([...timers.values()][0].delay,4000);
  stop();assert.equal(timers.size,0);
});

test("recover recent history without dropping newer in-flight events", () => {
  const message = (id, date, body=id) => ({
    id, createdAt:date, body, parentId:null, channelId:"synthetic"
  });
  const base = "2026-11-19T21:00:00.000Z";
  const current = [
    message("a","2026-11-19T20:50:00.000Z"),
    message("b",base,"stale b"),
    message("c","2026-11-19T21:01:00.000Z")
  ];
  const recent = [message("b",base,"server b"),
    message("d","2026-11-19T21:00:30.000Z")];
  const restored = reconcileRecentMessages(current,recent);
  assert.deepEqual(restored.map(m => m.id),["b","d","c"],
    "discard older loaded pages and preserve events that arrived after fetch");
  assert.equal(restored[0].body,"server b",
    "server response is authoritative for duplicate IDs");
  assert.deepEqual(reconcileRecentMessages(current,[]),[]);
});
