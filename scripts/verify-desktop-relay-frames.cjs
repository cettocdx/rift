#!/usr/bin/env node
// Synthetic frames only. Run against a configured test relay:
// node --env-file=.env.local scripts/verify-desktop-relay-frames.cjs
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Centrifuge, disconnectedCodes } = require('centrifuge');

const url = process.env.CENTRIFUGO_WS_URL;
const secret = process.env.CENTRIFUGO_TOKEN_SECRET;
assert(url && secret, 'Configure CENTRIFUGO_WS_URL and CENTRIFUGO_TOKEN_SECRET');

async function probe(image, expectRejection) {
  const user = `rift-frame-check-${crypto.randomUUID()}`;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user, exp: Math.floor(Date.now() / 1000) + 60 })}`;
  const token = `${unsigned}.${crypto.createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
  const client = new Centrifuge(url, { token, websocket: WebSocket });
  const subscription = client.newSubscription(`sandbox:connection:frame-check#${user}`);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      client.disconnect();
      error ? reject(error) : resolve();
    };
    const deadline = setTimeout(() => finish(new Error('Relay frame check timed out')), 10_000);
    client.on('disconnected', event => {
      if (settled) return;
      finish(expectRejection && event.code === disconnectedCodes.messageSizeLimit
        ? undefined : new Error(`Unexpected relay disconnect: ${event.code}`));
    });
    subscription.on('publication', ({ data }) => {
      if (expectRejection) return finish(new Error('Relay accepted an oversized frame'));
      try {
        assert.equal(data.result.image, image, 'Frame changed during relay round trip');
        finish();
      } catch (error) { finish(error); }
    });
    subscription.on('error', () => finish(new Error('Relay subscription failed')));
    subscription.on('subscribed', () => {
      void subscription.publish({
        type: 'desktop_local_access_result', requestId: 'synthetic', ok: true,
        result: { image, mediaType: 'image/jpeg' },
      }).catch(() => {
        // A size rejection closes the socket and is checked by disconnected.
        if (!expectRejection) finish(new Error('Relay publish failed'));
      });
    });
    subscription.subscribe();
    client.connect();
  });
}

(async () => {
  const image = Buffer.alloc(500 * 1024).toString('base64');
  await probe(image, false);
  console.log(`PASS: maximum native screenshot round trip (${image.length} base64 bytes)`);
  await probe('x'.repeat(1024 * 1024), true);
  console.log('PASS: oversized frame rejected; transport limit remains bounded');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
