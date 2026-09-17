#!/usr/bin/env node
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const LIMIT = 10000;

/** Raw Convex rows use phase, not status. Unknown/incomplete input fails closed.
 * This is an observation, not an atomic maintenance lease: recheck immediately
 * before maintenance and never use this snapshot to cancel or delete claims.
 */
function inspectClaimInventory(rows, limit = LIMIT) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || !Array.isArray(rows) || rows.length >= limit)
    throw new Error('Incomplete claim inventory; restart is not authorized.');
  const phases = { starting: 0, active: 0, released: 0 };
  const chats = new Set();
  for (const row of rows) {
    if (!row || typeof row.phase !== 'string' || !Object.hasOwn(phases, row.phase) ||
      ['user_id', 'chat_id', 'claim_id'].some(key => typeof row[key] !== 'string' || !row[key].trim()) ||
      !Number.isFinite(row.started_at) || !Number.isFinite(row.lease_until) ||
      (row.run_id !== undefined && (typeof row.run_id !== 'string' || !row.run_id.trim())) ||
      chats.has(row.chat_id))
      throw new Error('Invalid or ambiguous claim inventory; restart is not authorized.');
    chats.add(row.chat_id);
    phases[row.phase]++;
  }
  const unreleased = phases.starting + phases.active;
  return { count: rows.length, phases, unreleased, canRestart: unreleased === 0 };
}

function main() {
  const root = path.resolve(__dirname, '..');
  require('dotenv').config({ path: path.join(root, '.env.local'), quiet: true });
  try {
    const raw = execFileSync('pnpm', ['exec', 'convex', 'data', 'agent_run_claims', '--limit', String(LIMIT), '--format', 'json'], {
      cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = inspectClaimInventory(JSON.parse(raw));
    console.log(JSON.stringify(result));
    if (!result.canRestart) {
      console.error('Unreleased claims exist. Verify authoritative run state and reconcile through the application before maintenance.');
      process.exitCode = 2;
    }
  } catch {
    // Do not echo CLI stderr: it can contain deployment details or credentials.
    console.error('Unable to validate a complete claim inventory. No restart is authorized.');
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { inspectClaimInventory };
