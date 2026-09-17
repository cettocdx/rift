const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

// Run against the installed SDK implementation, without creating child tasks.
test('keep-warm retains a healthy process but preserves recycling and shutdown', async () => {
  const { TaskRunProcessPool } = await import(pathToFileURL(path.resolve('node_modules/trigger.dev/dist/esm/dev/taskRunProcessPool.js')));
  const previous = process.env.RIFT_TRIGGER_DEV_KEEP_WARM;
  const make = pid => ({ pid, isHealthy: true, isBeingKilled: false, kills: [], isExecuting: () => false, async cleanup(kill) { this.kills.push(kill); } });
  const pool = new TaskRunProcessPool({ enableProcessReuse: true, maxPoolSize: 2, maxExecutionsPerProcess: 2 });
  try {
    delete process.env.RIFT_TRIGGER_DEV_KEEP_WARM;
    const normal = make(1);
    await pool.returnProcess(normal, 'normal');
    assert.equal(pool.idleTimers.size, 1, 'SDK default timer remains opt-in compatible');
    await pool.shutdown();

    process.env.RIFT_TRIGGER_DEV_KEEP_WARM = '1';
    const warm = make(2);
    await pool.returnProcess(warm, 'warm');
    assert.equal(pool.idleTimers.size, 0, 'idle lifetime must not be scheduled');
    const borrowed = await pool.getProcess(null, { version: 'warm' });
    assert.equal(borrowed.taskRunProcess, warm);
    assert.equal(borrowed.isReused, true);
    await pool.returnProcess(warm, 'warm');
    assert.deepEqual(warm.kills, [false, true], 'execution cap still recycles');

    const old = make(3);
    await pool.returnProcess(old, 'old');
    pool.deprecateVersion('old');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(old.kills, [false, true], 'old versions still retire');

    const forced = make(4);
    await pool.returnProcess(forced, 'warm', { forceKill: true });
    assert.deepEqual(forced.kills, [true], 'unhealthy outcome is not retained');

    const live = make(5);
    await pool.returnProcess(live, 'live');
    await pool.shutdown();
    assert.deepEqual(live.kills, [false, true]);
    assert.equal(pool.getStats().totalCount, 0);
  } finally {
    await pool.shutdown();
    if (previous === undefined) delete process.env.RIFT_TRIGGER_DEV_KEEP_WARM;
    else process.env.RIFT_TRIGGER_DEV_KEEP_WARM = previous;
  }
});
