/** @jest-environment node */
import { execFileSync } from "node:child_process";
import path from "node:path";

// Exercise both shipped entries in fresh Node processes, not a mocked SDK.
it.each(["index.js", "index.mjs"])(
  "%s keeps explicit origin absence/false through SDK reconstruction",
  (entry) => {
    const filename = path.join(path.dirname(require.resolve("e2b")), entry);
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
    const { ConnectionConfig } = await import(${JSON.stringify(filename)});
    const origin = new ConnectionConfig({ environmentFallback: false, apiKey: 'fixture-a', debug: false, domain: 'a.test', apiUrl: 'https://api.a.test' });
    const missing = new ConnectionConfig({ environmentFallback: false });
    const rebuilt = new ConnectionConfig({ ...origin });
    const legacy = new ConnectionConfig();
    console.log(JSON.stringify({ origin, missing, rebuilt, legacy }));
  `,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            E2B_API_KEY: "fixture-b",
            E2B_ACCESS_TOKEN: "token-b",
            E2B_DOMAIN: "b.test",
            E2B_API_URL: "https://api.b.test",
            E2B_SANDBOX_URL: "https://sandbox.b.test",
            E2B_DEBUG: "true",
          },
        },
      ),
    );
    expect(result.origin).toMatchObject({
      apiKey: "fixture-a",
      debug: false,
      domain: "a.test",
      apiUrl: "https://api.a.test",
    });
    expect(result.origin).not.toHaveProperty("accessToken");
    expect(result.origin).not.toHaveProperty("sandboxUrl");
    expect(result.missing).toMatchObject({
      debug: false,
      domain: "e2b.app",
      apiUrl: "https://api.e2b.app",
    });
    expect(result.missing).not.toHaveProperty("apiKey");
    expect(result.missing).not.toHaveProperty("accessToken");
    expect(result.rebuilt).toEqual(result.origin);
    expect(result.legacy).toMatchObject({
      apiKey: "fixture-b",
      accessToken: "token-b",
      debug: true,
      domain: "b.test",
      apiUrl: "https://api.b.test",
      sandboxUrl: "https://sandbox.b.test",
    });
  },
);

it("installed SDK pagination retains original request destination and absent authorization", () => {
  // As in the existing SDK PTY test, compile a throwaway copy to replace only
  // the HTTP boundary. The actual paginator/config/header code remains intact.
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
    const requests = [];
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({url: request.url, key: request.headers.get('x-api-key'), authorization: request.headers.get('authorization')});
      return Response.json([]);
    };
    sdk._compile(fs.readFileSync(filename, 'utf8') + '\napiFetch = globalThis.fetch;', filename);
    const { Sandbox } = sdk.exports;
    const origin = { environmentFallback: false, apiKey: 'e2b_aaaaaaaa', domain: 'a.test', apiUrl: 'https://api.a.test', debug: false };
    const paginator = Sandbox.list(origin);
    process.env.E2B_API_KEY = 'e2b_bbbbbbbb';
    process.env.E2B_ACCESS_TOKEN = 'fixture-b';
    process.env.E2B_API_URL = 'https://api.b.test';
    process.env.E2B_DEBUG = 'true';
    (async () => {
      await paginator.nextItems();
      await Sandbox.list({ environmentFallback: false }).nextItems();
      assert.deepEqual(requests, [
        {url:'https://api.a.test/v2/sandboxes',key:'e2b_aaaaaaaa',authorization:null},
        {url:'https://api.e2b.app/v2/sandboxes',key:null,authorization:null},
      ]);
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `,
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
});

it("installed SDK lifecycle preserves origin through static and instance operations", () => {
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
    const requests = [];
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({url: request.url, method: request.method, key: request.headers.get('x-api-key'), authorization: request.headers.get('authorization')});
      if (request.method === 'DELETE' || request.url.endsWith('/timeout')) return new Response(null, {status:204});
      return Response.json({sandboxID:'fixture-a',domain:'a.test',envdVersion:'0.4.0',envdAccessToken:'envd-a'});
    };
    // Only the HTTP boundary is replaced in this throwaway SDK copy.
    sdk._compile(fs.readFileSync(filename, 'utf8') + '\napiFetch = globalThis.fetch;', filename);
    const { Sandbox } = sdk.exports;
    const origin = { environmentFallback:false, apiKey:'e2b_aaaaaaaa', domain:'a.test', apiUrl:'https://api.a.test', debug:false };
    (async () => {
      const created = await Sandbox.create('fixture-template', origin);
      Object.assign(process.env, {
        E2B_API_KEY:'e2b_bbbbbbbb', E2B_ACCESS_TOKEN:'token-b', E2B_DOMAIN:'b.test',
        E2B_API_URL:'https://api.b.test', E2B_SANDBOX_URL:'https://sandbox.b.test', E2B_DEBUG:'true',
      });
      const connected = await Sandbox.connect('fixture-a', origin);
      await connected.connect();
      await connected.setTimeout(1000);
      await connected.kill();
      await created.kill();
      await Sandbox.kill('fixture-a', origin);
      assert.equal(connected.connectionConfig.environmentFallback, false);
      assert.equal(connected.connectionConfig.debug, false);
      assert.equal(connected.connectionConfig.accessToken, undefined);
      assert.equal(connected.envdApiUrl, 'https://49983-fixture-a.a.test');
      assert.equal(requests.length, 7);
      for (const request of requests) {
        assert.ok(request.url.startsWith('https://api.a.test/'));
        assert.equal(request.key, 'e2b_aaaaaaaa');
        assert.equal(request.authorization, null);
      }
      // The SDK historically sends this without credentials; enforce that it
      // cannot silently add B's authority or destination. No real API is called.
      await Sandbox.create('fixture-template', {environmentFallback:false});
      assert.equal(requests.length, 8);
      assert.deepEqual(requests[7], {url:'https://api.e2b.app/sandboxes',method:'POST',key:null,authorization:null});
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `,
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
});
