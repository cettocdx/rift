#!/usr/bin/env node
// Read-only gate for the Next web process ONLY. Never authorizes restarting
// workers, terminating remote resources, or releasing cleanup claims.
const { inspectClaimInventory } = require('./preview-run-gate.cjs');
const TERMINAL = new Set(['COMPLETED','CANCELED','FAILED','CRASHED','SYSTEM_FAILURE','EXPIRED','TIMED_OUT']);
async function inspectWebMaintenance(rows, retrieve, httpExecutions = []) {
  if (!Array.isArray(httpExecutions) || httpExecutions.length >= 10000)
    throw new Error("HTTP execution inventory is incomplete");
  let activeHttpExecutions = 0;
  for (const execution of httpExecutions) {
    if (!["admitted", "running", "stopped", "terminal"].includes(execution.phase))
      throw new Error("Unknown HTTP execution phase");
    if (["admitted", "running"].includes(execution.phase)) activeHttpExecutions++;
  }
  const inventory = inspectClaimInventory(rows);
  let terminalProducers = 0, activeProducers = 0, pendingAdmissions = 0;
  for (const claim of rows) {
    if (claim.phase === 'released') continue;
    if (!claim.run_id) { pendingAdmissions++; continue; }
    const run = await retrieve(claim.run_id);
    if (run.id !== claim.run_id || !['agent-long','hack-long'].includes(run.taskIdentifier) ||
        run.payload?.userId !== claim.user_id || run.payload?.chatId !== claim.chat_id ||
        run.payload?.startClaimId !== claim.claim_id)
      throw new Error('Producer ownership cannot be verified');
    if (TERMINAL.has(run.status)) terminalProducers++;
    else activeProducers++;
  }
  return { scope:'web-only', count:inventory.count, terminalProducers, activeProducers,
    pendingAdmissions, activeHttpExecutions, canRestartWeb:activeProducers === 0 && pendingAdmissions === 0 && activeHttpExecutions === 0 };
}
async function main() {
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const root = path.resolve(__dirname,'..');
  require('dotenv').config({path:path.join(root,'.env.local'),quiet:true});
  const { runs } = require('@trigger.dev/sdk');
  try {
    const rows = JSON.parse(execFileSync('pnpm',['exec','convex','data','agent_run_claims','--limit','10000','--format','json'], {
      cwd:root,encoding:'utf8',maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe'],
    }));
    const httpExecutions = JSON.parse(execFileSync('pnpm',['exec','convex','data','hack_http_executions','--limit','10000','--format','json'], {
      cwd:root,encoding:'utf8',maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe'],
    }));
    const result = await inspectWebMaintenance(rows, id => runs.retrieve(id), httpExecutions);
    console.log(JSON.stringify(result));
    if (!result.canRestartWeb) process.exitCode = 2;
  } catch {
    console.error('Unable to verify web maintenance safety. No restart authorized.');
    process.exitCode = 1;
  }
}
module.exports = { inspectWebMaintenance };
if (require.main === module) void main();
