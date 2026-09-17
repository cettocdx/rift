// Run against the installed dependency, including uncaught microtask failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createAsyncIterableReadable as esm } from '@trigger.dev/core/v3';
const cjs = createRequire(import.meta.url)('@trigger.dev/core/v3').createAsyncIterableReadable;
for (const [format, createStream] of [['esm', esm], ['cjs', cjs]]) {
  test(`${format}: abort after EOF does not close twice`, async () => {
    const ac = new AbortController();
    const reader = createStream(new ReadableStream({start(c){c.close();}}), {}, ac.signal).getReader();
    assert.equal((await reader.read()).done, true);
    ac.abort();
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  test(`${format}: abort during read closes and cancels source`, async () => {
    const ac = new AbortController();
    let canceled = false;
    const reader = createStream(new ReadableStream({cancel(){canceled=true;}}), {}, ac.signal).getReader();
    const read = reader.read();
    ac.abort();
    assert.equal((await read).done, true);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(canceled, true);
  });
  test(`${format}: consumer cancellation releases upstream`, async () => {
    const ac = new AbortController();
    let canceled = false;
    const reader = createStream(new ReadableStream({cancel(){canceled=true;}}), {}, ac.signal).getReader();
    const read = reader.read();
    await reader.cancel();
    assert.equal((await read).done, true);
    assert.equal(canceled, true);
    ac.abort();
  });
  test(`${format}: source errors remain visible`, async () => {
    const ac = new AbortController();
    const reader = createStream(new ReadableStream({start(c){c.error(new Error('source failed'));}}), {}, ac.signal).getReader();
    await assert.rejects(reader.read(), /source failed/);
    ac.abort();
  });
  test(`${format}: pre-aborted subscription closes cleanly`, async () => {
    const ac = new AbortController(); ac.abort();
    const reader = createStream(new ReadableStream(), {}, ac.signal).getReader();
    assert.equal((await reader.read()).done, true);
  });
}
