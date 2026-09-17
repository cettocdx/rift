const { setTimeout: delay } = require('node:timers/promises');

// GET is deliberately unsupported by this route: Next loads its module and
// returns 405 without invoking authentication, task admission or model work.
async function warmBuildRoute(port, options = {}) {
  if (!['3020', '3022'].includes(String(port))) throw new Error('Invalid preview port');
  const request = options.fetch ?? fetch;
  const signal = AbortSignal.any([
    AbortSignal.timeout(60_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  for (let attempt = 0; attempt < (options.maxAttempts ?? 120); attempt++) {
    if (signal.aborted) return false;
    try {
      const response = await request(`http://127.0.0.1:${port}/api/agent-long`, {
        method: 'GET', redirect: 'error', signal,
      });
      await response.body?.cancel();
      if (response.status === 405) return true;
    } catch {
      if (signal.aborted) return false;
    }
    try {
      if (options.pause) await options.pause();
      else await delay(500, undefined, { signal });
    } catch { return false; }
  }
  return false;
}
module.exports = { warmBuildRoute };
