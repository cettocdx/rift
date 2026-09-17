import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for (const format of ['module', 'commonjs']) {
  for (const fails of [true, false]) {
    test(`${format}: writer ${fails ? 'failure is caught without killing process' : 'success completes'}`, () => {
      const imports = format === 'module'
        ? `import { streams } from '@trigger.dev/sdk'; import { realtimeStreams } from '@trigger.dev/core/v3';`
        : `const { streams } = require('@trigger.dev/sdk'); const { realtimeStreams } = require('@trigger.dev/core/v3');`;
      const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', `--input-type=${format}`, '-e', `${imports}
        (async () => {
          const failure = Object.assign(new Error('test connection timeout'), {code:'CONNECTION_TIMEOUT'});
          realtimeStreams.pipe = () => ({stream: new ReadableStream({start(c){c.close();}}), wait: () => ${fails ? 'Promise.reject(failure)' : 'Promise.resolve({})'}});
          const piped = streams.pipe('ui', new ReadableStream(), {target:'test-run'});
          let caught;
          try { await piped.waitUntilComplete(); } catch(e) { caught=e; }
          if (${fails} ? caught !== failure : caught !== undefined) throw Error('Incorrect error propagation');
          await new Promise(r => setTimeout(r, 25));
        })().catch(() => {process.exitCode=2;});
      `], {cwd:process.cwd(), encoding:'utf8', timeout:10000});
      assert.equal(child.status, 0, child.stderr);
    });
  }
}
