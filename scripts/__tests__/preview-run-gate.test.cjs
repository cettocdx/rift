const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectClaimInventory } = require('../preview-run-gate.cjs');
const row = (phase, extra = {}) => ({ user_id: 'u', chat_id: 'c', claim_id: 'q', phase, started_at: 1, lease_until: 2, ...extra });
test('blocks active and starting claims even when status is absent or misleading', () => {
  for (const phase of ['active', 'starting']) {
    const result = inspectClaimInventory([row(phase, { status: 'finished' })]);
    assert.equal(result.canRestart, false);
    assert.equal(result.unreleased, 1);
  }
});
test('released records are idle; stale leases and cancellation requests are not terminal proof', () => {
  assert.equal(inspectClaimInventory([row('released')]).canRestart, true);
  assert.equal(inspectClaimInventory([row('starting', { lease_until: 0, cancel_requested_at: 1 })]).canRestart, false);
});
test('rejects unknown schema, status-only records, incomplete pages and ambiguous chats', () => {
  for (const input of [null, {}, [{ status: 'active' }], [row('unknown')], [row(['released'])], [row('released', { user_id: '' })], [row('released', { started_at: NaN })], [row('released'), row('active')]]) {
    assert.throws(() => inspectClaimInventory(input));
  }
  assert.throws(() => inspectClaimInventory([row('released')], 1));
});
test('reports phase counts without exposing messages, owner IDs or run credentials', () => {
  assert.deepEqual(inspectClaimInventory([row('released')]), {
    count: 1, phases: { starting: 0, active: 0, released: 1 }, unreleased: 0, canRestart: true,
  });
});
