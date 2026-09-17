const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectWebMaintenance } = require('../preview-web-run-gate.cjs');
const claim = { user_id:'u', chat_id:'c', claim_id:'q', run_id:'r', phase:'active', started_at:1, lease_until:2 };
const run = { id:'r', taskIdentifier:'agent-long', status:'COMPLETED', payload:{ userId:'u', chatId:'c', startClaimId:'q' } };
test('terminal producer allows web-only maintenance without releasing its claim', async () => {
  const before = JSON.stringify(claim);
  assert.equal((await inspectWebMaintenance([claim], async () => run)).canRestartWeb, true);
  assert.equal(JSON.stringify(claim), before);
});
test('active, waiting and unknown producers prevent maintenance', async () => {
  for (const status of ['EXECUTING','WAITING','QUEUED','UNKNOWN'])
    assert.equal((await inspectWebMaintenance([claim], async () => ({...run,status}))).canRestartWeb, false);
});
test('starting claims without a producer fail closed', async () => {
  assert.equal((await inspectWebMaintenance([{...claim,phase:'starting',run_id:undefined}], async () => { throw Error('must not query'); })).canRestartWeb, false);
});
test('ownership mismatch and provider lookup errors fail closed', async () => {
  for (const altered of [{...run,id:'other'}, {...run,taskIdentifier:'other'}, {...run,payload:{...run.payload,userId:'other'}}, {...run,payload:{...run.payload,chatId:'other'}}, {...run,payload:{...run.payload,startClaimId:'other'}}])
    await assert.rejects(inspectWebMaintenance([claim], async () => altered));
  await assert.rejects(inspectWebMaintenance([claim], async () => { throw Error('offline'); }));
});
test('incomplete and ambiguous inventories fail closed', async () => {
  await assert.rejects(inspectWebMaintenance([claim,claim], async () => run));
});

test('HTTP Hack producers block restart even with no worker claim', async () => {
  for (const phase of ['admitted', 'running']) {
    const result = await inspectWebMaintenance([], async () => { throw Error('no worker'); }, [{phase}]);
    assert.equal(result.canRestartWeb, false);
    assert.equal(result.activeHttpExecutions, 1);
  }
});
test('terminal HTTP executions permit restart but unknown inventory fails closed', async () => {
  assert.equal((await inspectWebMaintenance([], async () => {}, [{phase:'terminal'}, {phase:'stopped'}])).canRestartWeb, true);
  await assert.rejects(() => inspectWebMaintenance([], async () => {}, [{phase:'unknown'}]));
  await assert.rejects(() => inspectWebMaintenance([], async () => {}, Array(10000).fill({phase:'terminal'})));
});
