const {test}=require('node:test');
const assert=require('node:assert/strict');
const config={model:'build',models:[{value:'build',label:'Build'}],modelEfforts:{build:[{value:'medium',label:'Medium'}]},permissions:[{value:'ask',label:'Ask'}],targets:[{value:'e2b',label:'Cloud'}]};
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
const sse=chunks=>new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join(''));
const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Condition timed out');};
async function make(extra){const {IndependentConsoleClient}=await import('../dist/independent-client.js');const calls=[];const request=async(path,init)=>{calls.push({path,init});if(path==='/api/console/config')return json(config);if(path.startsWith('/api/console/history'))return json({entries:[]});if(path.startsWith('/api/console/approvals'))return json([]);return extra(path,init);};const client=new IndependentConsoleClient(request);await client.initialize();return {client,calls};}
test('submits once into its own session, separate from any app conversation',async()=>{
 const {client,calls}=await make((p,i)=>i?.method==='POST'?sse([{type:'start',messageId:'answer'},{type:'text-delta',id:'part',delta:'OK'},{type:'finish'}]):new Response(null,{status:204}));
 await client.send({type:'submit',chatId:client.snapshot.chatId,text:'hello'});await wait(()=>client.snapshot.status==='ready');
 const posts=calls.filter(c=>c.init?.method==='POST');assert.equal(posts.length,1);assert.equal(JSON.parse(posts[0].init.body).chatId,client.snapshot.chatId);assert.equal(client.snapshot.entries.at(-1).text,'OK');
 await assert.rejects(client.send({type:'submit',chatId:'another-chat',text:'wrong'}),/another console/);client.close();
});
test('replays replace partial output; reconnect reads without resending a task',async()=>{
 let reads=0;
 const {client,calls}=await make((p,i)=>{if(i?.method==='POST')return sse([{type:'start',messageId:'answer'},{type:'text-delta',id:'part',delta:'hel'}]);if(reads++===0)return new Response(null,{status:204});return sse([{type:'start',messageId:'answer'},{type:'text-delta',id:'part',delta:'hello'},{type:'finish'}]);});
 await client.send({type:'submit',chatId:client.snapshot.chatId,text:'hello'});await wait(()=>client.snapshot.status==='ready');assert.equal(client.snapshot.entries.filter(e=>e.kind==='assistant').length,1);assert.equal(client.snapshot.entries.at(-1).text,'hello');assert.equal(calls.filter(c=>c.init?.method==='POST').length,1);client.close();
});
test('closing a terminal cancels its reader but never cancels its worker',async()=>{
 let cancelled=false;
 const {client,calls}=await make((p,i)=>i?.method==='POST'?new Response(new ReadableStream({cancel(){cancelled=true;}})):new Response(null,{status:204}));
 await client.send({type:'submit',chatId:client.snapshot.chatId,text:'task'});await assert.rejects(client.send({type:'new-chat'}),/running/);client.close();await wait(()=>cancelled);assert.equal(calls.some(c=>c.path.includes('/cancel')),false);
});
test('explicit stop calls the worker cancellation endpoint',async()=>{
 const {client,calls}=await make((p,i)=>p.includes('/cancel')?json({ok:true}):i?.method==='POST'?new Response(new ReadableStream()):new Response(null,{status:204}));
 await client.send({type:'submit',chatId:client.snapshot.chatId,text:'task'});await client.send({type:'stop',chatId:client.snapshot.chatId});assert.equal(client.snapshot.status,'ready');assert.equal(calls.filter(c=>c.path.includes('/cancel')).length,1);client.close();
});
test('authentication failure is visible and never falls back to the main chat',async()=>{
 const {IndependentConsoleClient}=await import('../dist/independent-client.js');const client=new IndependentConsoleClient(async()=>new Response(null,{status:401}));await assert.rejects(client.initialize(),/Sign in/);assert.equal(client.snapshot.status,'error');assert.match(client.snapshot.entries[0].text,/rift login/);client.close();
});

test('cloud reasoning keeps distinct blocks in stream order',async()=>{
 const {client}=await make((p,i)=>i?.method==='POST'?sse([
 {type:'start',messageId:'answer'},
 {type:'reasoning-delta',id:'r1',delta:'Check '},
 {type:'reasoning-delta',id:'r1',delta:'input'},
 {type:'text-delta',id:'text',delta:'Done'},
 {type:'reasoning-delta',id:'r2',delta:'Verify result'},
 {type:'finish'}]):new Response(null,{status:204}));
 await client.send({type:'submit',chatId:client.snapshot.chatId,text:'hello'});
 await wait(()=>client.snapshot.status==='ready');
 assert.deepEqual(client.snapshot.entries.filter(e=>e.id.startsWith('answer:')).map(e=>e.text),['Check input','Done','Verify result']);
 client.close();
});

test('recovery survives a failed resume request without submitting the task again', async () => {
 let reads = 0;
 const {client, calls} = await make((path, init) => {
  if (init?.method === 'POST') return sse([{type:'start', messageId:'answer'}]);
  if (reads++ === 0) return new Response(null, {status:204});
  if (reads === 2) throw new TypeError('fetch failed');
  return sse([{type:'start', messageId:'answer'}, {type:'text-delta', id:'part', delta:'Recovered'}, {type:'finish'}]);
 });
 try {
  await client.send({type:'submit', chatId:client.snapshot.chatId, text:'task'});
  await wait(() => client.snapshot.status === 'ready');
  assert.equal(client.snapshot.entries.at(-1).text, 'Recovered');
  assert.equal(calls.filter(call => call.init?.method === 'POST').length, 1);
  assert.equal(reads, 3);
 } finally { client.close(); }
});

test('a resume response arriving after Stop cannot revive the old task', async () => {
 let reads = 0;
 let resolveResume;
 let cancelled = false;
 const {client} = await make((path, init) => {
  if (path.includes('/cancel')) return json({ok:true});
  if (init?.method === 'POST') return sse([{type:'start', messageId:'answer'}]);
  if (reads++ === 0) return new Response(null, {status:204});
  return new Promise(resolve => { resolveResume = resolve; });
 });
 try {
  await client.send({type:'submit', chatId:client.snapshot.chatId, text:'task'});
  await wait(() => resolveResume);
  await client.send({type:'stop', chatId:client.snapshot.chatId});
  resolveResume(new Response(new ReadableStream({
   start(controller) { controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'text-delta', id:'late', delta:'stale output'})+'\n\n')); },
   cancel() { cancelled = true; },
  })));
  await wait(() => cancelled || client.snapshot.entries.some(entry => entry.text === 'stale output'));
  assert.equal(cancelled, true);
  assert.equal(client.snapshot.entries.some(entry => entry.text === 'stale output'), false);
  assert.equal(client.snapshot.status, 'ready');
 } finally { client.close(); }
});
