/** @jest-environment node */
import { execFileSync } from "node:child_process";

// Exercise the installed SDK event loop, not a mocked callback dispatcher.
// CommandHandle is internal; expose it only in a throwaway Node module in
// this subprocess. No production SDK internals are accessed by RIFT.
it("waits for PTY callback credit before reading another SDK event", () => {
  execFileSync(
    process.execPath,
    [
      "-e",
      String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
    const filename = require.resolve('e2b');
    const sdk = new Module(filename, module);
    sdk.filename = filename;
    sdk.paths = Module._nodeModulePaths(path.dirname(filename));
    sdk._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.TestCommandHandle = CommandHandle;', filename);
    const { TestCommandHandle } = sdk.exports;
    (async () => {
      let release, read = 0, delivered = 0;
      const credit = new Promise(r => { release = r; });
      async function* events() {
        for (let i = 0; i < 64; i++) {
          read++;
          yield {event: {event: {case:'data', value:{output:{case:'pty',value:Buffer.from('payload')}}}}};
        }
        yield {event: {event: {case:'end',value:{exitCode:0}}}};
      }
      const handle = new TestCommandHandle(1, () => {}, async () => true, events(), undefined, undefined, async () => { delivered++; await credit; });
      await new Promise(r => setImmediate(r));
      assert.equal(read, 1, 'SDK read ahead while its PTY consumer had no credit');
      assert.equal(delivered, 1);
      release();
      assert.equal((await handle.wait()).exitCode, 0);
      assert.equal(delivered, 64);
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `,
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
});
