import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
import { withWorkerCrashMonitor } from './lib/agent/worker-crash-monitor.ts';
await withWorkerCrashMonitor('run_regression', async () => {
 setTimeout(() => { throw new Error('SECRET_MESSAGE'); }, 0);
 await new Promise(() => {});
});`], {encoding:'utf8'});
assert.equal(result.status, 1, result.stderr);
const record = result.stderr.split('\n').find(line=>line.startsWith('{"timestamp"'));
assert.ok(record, result.stderr);
const event = JSON.parse(record);
assert.equal(event.request_id, 'run_regression');
assert.equal(event.event, 'agent_worker_uncaught_exception');
assert.ok(event.frames.length);
assert.ok(!record.includes('SECRET_MESSAGE'));
const cleanup = spawnSync(process.execPath, ['--experimental-strip-types','--input-type=module','-e',`
import { withWorkerCrashMonitor } from './lib/agent/worker-crash-monitor.ts';
import assert from 'node:assert/strict';
const before=process.listenerCount('uncaughtExceptionMonitor');
await withWorkerCrashMonitor('success', async()=>42);
await assert.rejects(withWorkerCrashMonitor('failure', async()=>{throw Error('expected');}));
assert.equal(process.listenerCount('uncaughtExceptionMonitor'),before);
`],{encoding:'utf8'});
assert.equal(cleanup.status,0,cleanup.stderr);
console.log('PASS: fatal exit preserved, correlated stack captured, message excluded, listeners cleaned');
