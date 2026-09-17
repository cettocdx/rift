const { test } = require('node:test');
const assert = require('node:assert/strict');
const { warmBuildRoute } = require('../warm-build-route.cjs');
test('warms only a GET on the local Build route, with no credentials or task payload', async () => {
  const calls=[];
  const result=await warmBuildRoute('3020', { fetch: async (...args)=>{calls.push(args);return {status:405,body:{cancel:async()=>{}}};} });
  assert.equal(result,true);
  assert.equal(calls[0][0],'http://127.0.0.1:3020/api/agent-long');
  assert.equal(calls[0][1].method,'GET');
  assert.equal(calls[0][1].body,undefined);
  assert.equal(calls[0][1].headers,undefined);
  assert.equal(calls[0][1].redirect,'error');
});
test('retries a not-yet-listening server but never accepts a login redirect as readiness', async()=>{
  let attempts=0;
  assert.equal(await warmBuildRoute('3022',{fetch:async()=>{if(++attempts===1)throw Error('ECONNREFUSED');return {status:405};}, pause:async()=>{}}),true);
  assert.equal(attempts,2);
  assert.equal(await warmBuildRoute('3020',{fetch:async()=>({status:302}),maxAttempts:1,pause:async()=>{}}),false);
});
test('stops when the server exits and rejects arbitrary destinations', async()=>{
  const c=new AbortController();c.abort();let calls=0;
  assert.equal(await warmBuildRoute('3020',{signal:c.signal,fetch:async()=>{calls++;}}),false);
  assert.equal(calls,0);
  await assert.rejects(()=>warmBuildRoute('https://example.com'),/port/);
});
