const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ensureBrowserRuntime } = require("../browser-runtime.cjs");

test("ready runtime launches and closes without installing", async () => {
  let closes = 0;
  await ensureBrowserRuntime({
    launch: async () => ({ close: async () => closes++ }),
    install: async () => assert.fail("must not download on each start"),
  });
  assert.equal(closes, 1);
});

test("missing browser installs the pinned runtime and verifies it by launching", async () => {
  const calls = [];
  await ensureBrowserRuntime({
    launch: async () => {
      calls.push("launch");
      if (calls.length === 1)
        throw new Error(
          "browserType.launch: Executable doesn't exist at /cache/headless_shell",
        );
      return { close: async () => calls.push("close") };
    },
    install: async () => calls.push("install"),
  });
  assert.deepEqual(calls, ["launch", "install", "launch", "close"]);
});

test("host failures do not trigger repeated downloads", async () => {
  await assert.rejects(
    ensureBrowserRuntime({
      launch: async () => {
        throw new Error("Missing libnss3.so");
      },
      install: async () => assert.fail("host dependency failure"),
    }),
    /libnss3/,
  );
});

test("failed install or launch fails readiness instead of starting without a browser", async () => {
  let installs = 0;
  await assert.rejects(
    ensureBrowserRuntime({
      launch: async () => {
        throw new Error("Executable doesn't exist");
      },
      install: async () => {
        installs++;
      },
    }),
    /Executable/,
  );
  assert.equal(installs, 1);
});
