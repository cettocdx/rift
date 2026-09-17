const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
test('fresh starts get separate sessions; resume explicitly restores latest',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rift-fresh-'));
 process.env.RIFT_CONFIG_DIR=join(dir,'config');process.env.RIFT_API_KEY='fixture';
 const originalFetch=global.fetch;
 global.fetch=async()=>new Response(JSON.stringify({model:'test',models:[{value:'test',label:'Test'}],modelEfforts:{test:[]},permissions:[],targets:[]}));
 const {createLocalSession}=await import('../dist/standalone-session.js');
 let first,second,resumed;
 try {
  first=await createLocalSession('http://localhost:3020',dir,false);
  second=await createLocalSession('http://localhost:3020',dir,false);
  assert.notEqual(first.snapshot.chatId,second.snapshot.chatId);
  assert.deepEqual(second.snapshot.entries,[]);
  const id=second.snapshot.chatId;await second.close();second=null;
  resumed=await createLocalSession('http://localhost:3020',dir,true);
  assert.equal(resumed.snapshot.chatId,id);
 }finally{await first?.close();await second?.close();await resumed?.close();global.fetch=originalFetch;delete process.env.RIFT_CONFIG_DIR;delete process.env.RIFT_API_KEY;await rm(dir,{recursive:true,force:true});}
});
