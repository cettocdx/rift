// Offline transport check: actual ConvexHttpClient, local HTTP servers only.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "../..");

test("real Convex transport keeps concurrent runs and late cancellation on their own endpoint", async () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "rift-convex-scope-http-"),
  );
  const previous = process.env.NEXT_PUBLIC_CONVEX_URL;
  const servers = [];
  try {
    const store = path.join(root, "node_modules/.pnpm");
    const installed = fs
      .readdirSync(store)
      .filter((name) => /^esbuild@/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    assert.ok(installed, "workspace esbuild dependency must be installed");
    const esbuild = require(
      path.join(store, installed, "node_modules/esbuild"),
    );
    const output = path.join(temp, "scope.cjs");
    esbuild.buildSync({
      stdin: {
        contents:
          'export * from "./lib/db/convex-client"; export * from "./lib/db/convex-client-scope";',
        resolveDir: root,
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: output,
    });
    const {
      withConvexClientScope,
      bindConvexClientScope,
      getConvexClient,
    } = require(output);
    const requests = [];
    async function endpoint(label) {
      const server = http.createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { path: functionPath, args } = JSON.parse(body);
        requests.push({
          label,
          functionPath,
          auth: req.headers.authorization,
          user: args[0]?.userId,
        });
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({ status: "success", value: label, logLines: [] }),
        );
      });
      servers.push(server);
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}`;
    }
    const a = await endpoint("A"),
      b = await endpoint("B");
    process.env.NEXT_PUBLIC_CONVEX_URL = b;
    let cleanup;
    let release;
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    const runA = withConvexClientScope(a, async () => {
      const client = getConvexClient();
      client.setAuth("offline-user-a");
      cleanup = bindConvexClientScope(() =>
        getConvexClient().mutation("scope:cleanup", { userId: "a" }),
      );
      await wait;
      return client.query("scope:read", { userId: "a" });
    });
    const runB = withConvexClientScope(undefined, async () => {
      release();
      return getConvexClient().query("scope:read", { userId: "b" });
    });
    assert.deepEqual(await Promise.all([runA, runB]), ["A", "B"]);
    await withConvexClientScope(b, async () => {
      assert.equal(await cleanup(), "A");
      assert.equal(
        await getConvexClient().mutation("scope:write", { userId: "b" }),
        "B",
      );
    });
    const aRequests = requests.filter((request) => request.user === "a");
    const bRequests = requests.filter((request) => request.user === "b");
    assert.equal(aRequests.length, 2);
    assert.equal(bRequests.length, 2);
    for (const request of aRequests) {
      assert.equal(request.label, "A");
      assert.equal(request.auth, "Bearer offline-user-a");
    }
    for (const request of bRequests) {
      assert.equal(request.label, "B");
      assert.equal(request.auth, undefined);
    }
    // Same deployment on another run still gets a fresh unauthenticated client.
    assert.equal(
      await withConvexClientScope(a, () =>
        getConvexClient().query("scope:read", { userId: "c" }),
      ),
      "A",
    );
    assert.equal(requests.at(-1).auth, undefined);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
    else process.env.NEXT_PUBLIC_CONVEX_URL = previous;
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve) => {
            server.close(resolve);
            server.closeAllConnections();
          }),
      ),
    );
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
