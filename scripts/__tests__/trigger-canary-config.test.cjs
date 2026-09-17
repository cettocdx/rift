const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");

// Evaluate the real configs with inert SDK/build factories. No CLI, dotenv file,
// application module or network operation executes in this offline check.
function loadConfig(file, initialEnv = {}) {
  const env = { ...initialEnv };
  const loads = [];
  const cache = new Map();
  const stubs = {
    dotenv: {
      config: (options) => {
        loads.push(options);
        env.TRIGGER_PROJECT_ID ||= "fixture-project";
      },
    },
    "@trigger.dev/sdk": { defineConfig: (value) => value },
    "@trigger.dev/build/extensions/core": {
      syncEnvVars: (callback) => ({ name: "sync-env-vars", callback }),
      additionalPackages: (options) => ({
        name: "additional-packages",
        options,
      }),
    },
    "@trigger.dev/build/extensions/playwright": {
      playwright: (options) => ({ name: "playwright", options }),
    },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      source,
      {
        exports: module.exports,
        module,
        process: { env },
        require(specifier) {
          if (stubs[specifier]) return stubs[specifier];
          assert.ok(
            specifier.startsWith("."),
            `Unexpected config dependency: ${specifier}`,
          );
          return load(path.resolve(path.dirname(filename), `${specifier}.ts`));
        },
      },
      { filename },
    );
    return module.exports;
  }
  return { config: load(path.join(root, file)).default, loads, env };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test("hosted canary build ignores stale Docker Desktop credentials and cleans its private config", () => {
  const os = require("node:os");
  const { runCanary } = require("../trigger-staging-canary.cjs");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "rift-docker-home-"));
  fs.mkdirSync(path.join(fixture, ".docker"));
  const configFile = path.join(fixture, ".docker/config.json");
  const original = JSON.stringify({ credsStore: "desktop", auths: {} });
  fs.writeFileSync(configFile, original);
  let isolated;
  try {
    const result = runCanary(
      ["--hack", "--deploy"],
      {
        HOME: fixture,
        PATH: "/usr/bin",
        DOCKER_CONFIG: "/must-not-inherit",
      },
      (_executable, args, options) => {
        isolated = options.env.DOCKER_CONFIG;
        assert.ok(isolated && isolated !== path.dirname(configFile));
        assert.notEqual(isolated, "/must-not-inherit");
        assert.deepEqual(
          JSON.parse(fs.readFileSync(path.join(isolated, "config.json"))),
          { auths: {} },
        );
        assert.equal(fs.statSync(isolated).mode & 0o777, 0o700);
        assert.equal(
          fs.statSync(path.join(isolated, "config.json")).mode & 0o777,
          0o600,
        );
        assert.ok(args.includes("staging"));
        assert.ok(args.includes("--skip-promotion"));
        return { status: 0 };
      },
    );
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(isolated), false);
    assert.equal(fs.readFileSync(configFile, "utf8"), original);
    assert.throws(
      () =>
        runCanary([], { HOME: fixture }, (_exe, _args, options) => {
          isolated = options.env.DOCKER_CONFIG;
          throw new Error("spawn failure");
        }),
      /spawn failure/,
    );
    assert.equal(fs.existsSync(isolated), false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("deploy layer installs the dynamically imported sandbox transport at a fixed version", async () => {
  const { additionalPackages } =
    await import("@trigger.dev/build/extensions/core");
  const { config } = loadConfig("trigger.canary.config.ts", {
    NODE_ENV: "production",
    RIFT_TRIGGER_CANARY: "staging",
  });
  const configured = config.build.extensions.find(
    (extension) => extension.name === "additional-packages",
  );
  const layers = [];
  await additionalPackages(plain(configured.options)).onBuildStart({
    target: "deploy",
    resolvePath: async () => undefined,
    addLayer: (layer) => layers.push(layer),
  });
  assert.equal(layers.length, 1);
  assert.equal(layers[0].dependencies.undici, "7.25.0");
  assert.equal(layers[0].dependencies.sharp, "0.34.5");
  assert.equal(layers[0].dependencies["node-pty"], "1.2.0-beta.12");
});

test("ordinary config retains runtime, build requirements, dotenv and optional MCP sync", () => {
  const { config, loads } = loadConfig("trigger.config.ts", {
    MCP_CREDENTIALS_ACTIVE_KEY_VERSION: " fixture-v1 ",
    MCP_CREDENTIALS_ENCRYPTION_KEYS: " fixture-keyring ",
  });
  assert.deepEqual(plain(loads), [{ path: ".env.local" }]);
  assert.equal(config.project, "fixture-project");
  assert.deepEqual(plain(config.dirs), ["./trigger"]);
  assert.equal(config.runtime, "node-22");
  assert.equal(config.logLevel, "log");
  assert.equal(config.enableConsoleLogging, true);
  assert.equal(config.maxDuration, 3600);
  assert.deepEqual(plain(config.retries), {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  });
  assert.deepEqual(plain(config.build.external), [
    "node-pty",
    "sharp",
    "playwright",
    "playwright-core",
    "chromium-bidi",
    "undici",
  ]);
  assert.deepEqual(
    config.build.extensions.map((e) => e.name).join(","),
    "sync-env-vars,additional-packages,playwright",
  );
  assert.deepEqual(plain(config.build.extensions[0].callback()), {
    MCP_CREDENTIALS_ACTIVE_KEY_VERSION: "fixture-v1",
    MCP_CREDENTIALS_ENCRYPTION_KEYS: "fixture-keyring",
  });
  assert.deepEqual(plain(config.build.extensions[1].options), {
    packages: ["node-pty@1.2.0-beta.12", "sharp@0.34.5", "undici@7.25.0"],
  });
  assert.deepEqual(plain(config.build.extensions[2].options), {
    browsers: ["chromium"],
    version: "1.55.0",
  });
  const prod = loadConfig("trigger.config.ts", {
    NODE_ENV: "production",
    TRIGGER_PROJECT_ID: "fixture-prod",
  });
  assert.equal(prod.loads.length, 0);
  assert.equal(prod.config.project, "fixture-prod");
  assert.equal(prod.config.enableConsoleLogging, false);
  assert.equal(prod.config.build.extensions[0].callback(), undefined);
});

test("canary refuses direct invocation and has no dotenv or secret-sync side effects", () => {
  assert.ok(
    fs.existsSync(path.join(root, "trigger.canary.config.ts")),
    "missing separate canary config",
  );
  assert.throws(() => loadConfig("trigger.canary.config.ts"), /staging-canary/);
  const ordinary = loadConfig("trigger.config.ts", {
    NODE_ENV: "production",
  }).config;
  const { config, loads } = loadConfig("trigger.canary.config.ts", {
    NODE_ENV: "production",
    RIFT_TRIGGER_CANARY: "staging",
    TRIGGER_PROJECT_ID: "must-not-use",
    MCP_CREDENTIALS_ACTIVE_KEY_VERSION: "must-not-sync",
    MCP_CREDENTIALS_ENCRYPTION_KEYS: "must-not-sync",
  });
  assert.equal(loads.length, 0);
  assert.equal(config.project, "proj_tzdasuzvmzpcjmlcafvs");
  assert.deepEqual(plain(config.dirs), ["./trigger-canary"]);
  assert.equal(config.enableConsoleLogging, false);
  for (const key of ["runtime", "logLevel", "maxDuration", "retries"])
    assert.deepEqual(plain(config[key]), plain(ordinary[key]));
  assert.deepEqual(
    plain(config.build.external),
    plain(ordinary.build.external),
  );
  assert.deepEqual(
    plain(config.build.extensions),
    plain(ordinary.build.extensions.slice(1)),
  );
});

test("launcher fixes staging flags and strips inherited app, dotenv, Node injection and CLI override variables", () => {
  const file = path.join(root, "scripts/trigger-staging-canary.cjs");
  assert.ok(fs.existsSync(file), "missing controlled staging launcher");
  const { canaryInvocation } = require(file);
  const input = {
    HOME: "/fixture/home",
    PATH: "/fixture/bin",
    TMPDIR: "/fixture/tmp",
    LANG: "C",
    CONVEX_SERVICE_ROLE_KEY: "not-a-secret-fixture",
    NEXT_PUBLIC_CONVEX_URL: "fixture",
    UPSTASH_REDIS_REST_TOKEN: "fixture",
    MCP_CREDENTIALS_ENCRYPTION_KEYS: "fixture",
    TRIGGER_PROJECT_REF: "wrong",
    TRIGGER_SECRET_KEY: "wrong",
    NODE_OPTIONS: "--require bad",
    DOTENV_CONFIG_PATH: ".env.local",
    RIFT_TRIGGER_CANARY: "prod",
  };
  const invocation = canaryInvocation([], input);
  assert.deepEqual(invocation.env, {
    HOME: "/fixture/home",
    PATH: "/fixture/bin",
    TMPDIR: "/fixture/tmp",
    LANG: "C",
    NODE_ENV: "production",
    RIFT_TRIGGER_CANARY: "staging",
  });
  assert.deepEqual(invocation.args.slice(1), [
    "deploy",
    ".",
    "--config",
    "trigger.canary.config.ts",
    "--project-ref",
    "proj_tzdasuzvmzpcjmlcafvs",
    "--env",
    "staging",
    "--env-file",
    "/dev/null",
    "--skip-update-check",
    "--skip-sync-env-vars",
    "--skip-promotion",
    "--dry-run",
  ]);
  assert.equal(
    canaryInvocation(["--deploy"], input).args.includes("--dry-run"),
    false,
  );
  for (const args of [
    ["--env", "prod"],
    ["--deploy", "--dry-run"],
    ["--config", "trigger.config.ts"],
  ])
    assert.throws(() => canaryInvocation(args, input), /Usage/);
  assert.equal(input.RIFT_TRIGGER_CANARY, "prod");
});

test("offline canary graph accepts only the agent registration and rejects a transitive schedule", async () => {
  const file = path.join(root, "scripts/verify-trigger-canary-graph.cjs");
  assert.ok(fs.existsSync(file), "missing transitive discovery check");
  const { inspectCanaryGraph, assertAgentOnly } = require(file);
  const report = await inspectCanaryGraph(root);
  assertAgentOnly(report);
  assert.ok(report.repositoryModules > 1);
  assert.ok(
    report.externalImports.length > 0,
    "external packages must be disclosed as uninspected",
  );
  assert.deepEqual(report.triggerFiles, [
    "trigger/agent-long.ts",
    "trigger/stream-ids.ts",
    "trigger/streams.ts",
  ]);
  const unsafe = await inspectCanaryGraph(root, {
    contents:
      'export { agentLongTask } from "./trigger/agent-long"; import "./trigger/keep-warm";',
  });
  assert.throws(() => assertAgentOnly(unsafe), /agent-long registration only/);
});

test("installed CLI config loader ignores dotenv fixture files for the canary", () => {
  const os = require("node:os");
  const { spawnSync } = require("node:child_process");
  const { pathToFileURL } = require("node:url");
  const { canaryInvocation } = require("../trigger-staging-canary.cjs");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "rift-canary-config-"));
  try {
    for (const name of ["trigger.canary.config.ts", "trigger.shared.ts"])
      fs.copyFileSync(path.join(root, name), path.join(fixture, name));
    fs.mkdirSync(path.join(fixture, "trigger-canary"));
    fs.symlinkSync(
      path.join(root, "node_modules"),
      path.join(fixture, "node_modules"),
      "dir",
    );
    fs.writeFileSync(path.join(fixture, "package.json"), '{"private":true}');
    fs.writeFileSync(
      path.join(fixture, "pnpm-lock.yaml"),
      'lockfileVersion: \"9.0\"\n',
    );
    fs.writeFileSync(
      path.join(fixture, ".env"),
      "RIFT_CANARY_DOTENV_PROBE=unexpected\n",
    );
    fs.writeFileSync(
      path.join(fixture, ".env.local"),
      "RIFT_CANARY_DOTENV_PROBE=unexpected\n",
    );
    const configModule = pathToFileURL(
      path.resolve(
        path.dirname(require.resolve("trigger.dev/package.json")),
        "dist/esm/config.js",
      ),
    ).href;
    const source = `import { loadConfig } from ${JSON.stringify(configModule)};
      const config = await loadConfig({ cwd: process.cwd(), configFile: 'trigger.canary.config.ts', warn: false });
      if (process.env.RIFT_CANARY_DOTENV_PROBE) throw new Error('Unexpected dotenv load');
      if (config.project !== 'proj_tzdasuzvmzpcjmlcafvs' || config.runtime !== 'node-22') throw new Error('Wrong config');
      if (config.build.extensions.some(extension => extension.name.includes('sync-env'))) throw new Error('Unexpected sync extension');`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        cwd: fixture,
        env: canaryInvocation([], process.env).env,
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("ordinary worker uses a bounded reusable pool with an explicit rollback", () => {
  const { config } = loadConfig("trigger.config.ts");
  assert.deepEqual(plain(config.processKeepAlive), {
    enabled: true,
    devMaxPoolSize: 2,
    maxExecutionsPerProcess: 10,
  });
  const disabled = loadConfig("trigger.config.ts", {
    RIFT_WORKER_PROCESS_REUSE: "false",
  }).config;
  assert.equal(disabled.processKeepAlive.enabled, false);
  const canary = loadConfig("trigger.canary.config.ts", {
    NODE_ENV: "production",
    RIFT_TRIGGER_CANARY: "staging",
  }).config;
  assert.equal(canary.processKeepAlive, undefined);
});

test("graph records the Hack registration created through an imported task factory", async () => {
  const {
    inspectCanaryGraph,
    assertAgentOnly,
  } = require("../verify-trigger-canary-graph.cjs");
  const report = await inspectCanaryGraph(root, {
    contents: 'export { hackLongTask } from "./trigger/hack-long";',
  });
  assert.deepEqual(report.registrations.map((r) => r.id).sort(), [
    "agent-long",
    "hack-long",
  ]);
  assert.throws(() => assertAgentOnly(report));
});

test("graph tracks renamed factory imports at the entry instead of hiding extra registrations", async () => {
  const {
    inspectCanaryGraph,
    assertAgentOnly,
  } = require("../verify-trigger-canary-graph.cjs");
  const report = await inspectCanaryGraph(root, {
    contents:
      'import { createAgentLongTask as register } from "./trigger/agent-long"; export const hidden = register("unexpected-task");',
  });
  assert.ok(report.registrations.some((r) => r.id === "unexpected-task"));
  assert.throws(() => assertAgentOnly(report));
});

test("Hack canary uses its separate task directory without importing ordinary runtime configuration", async () => {
  assert.throws(
    () => loadConfig("trigger.hack-canary.config.ts"),
    /staging-canary/,
  );
  const { config, loads } = loadConfig("trigger.hack-canary.config.ts", {
    NODE_ENV: "production",
    RIFT_TRIGGER_CANARY: "staging",
    TRIGGER_PROJECT_ID: "wrong",
    MCP_CREDENTIALS_ENCRYPTION_KEYS: "must-not-sync",
  });
  assert.deepEqual(plain(config.dirs), ["./trigger-hack-canary"]);
  assert.equal(config.project, "proj_tzdasuzvmzpcjmlcafvs");
  assert.equal(loads.length, 0);
  assert.equal(
    config.build.extensions.some((e) => e.name === "sync-env-vars"),
    false,
  );
  const { canaryInvocation } = require("../trigger-staging-canary.cjs");
  const invocation = canaryInvocation(["--hack"], {
    TRIGGER_SECRET_KEY: "must-not-copy",
  });
  assert.ok(invocation.args.includes("trigger.hack-canary.config.ts"));
  assert.ok(invocation.args.includes("--dry-run"));
  assert.ok(invocation.args.includes("--skip-promotion"));
  assert.equal(invocation.env.TRIGGER_SECRET_KEY, undefined);
  assert.equal(
    canaryInvocation(["--hack", "--deploy"], {}).args.includes("--dry-run"),
    false,
  );
  assert.throws(() => canaryInvocation(["--hack", "--hack"], {}), /Usage/);
  const {
    inspectCanaryGraph,
    assertHackCanary,
  } = require("../verify-trigger-canary-graph.cjs");
  const report = await inspectCanaryGraph(root, undefined, "hack");
  assertHackCanary(report);
  assert.deepEqual(report.registrations.map((r) => r.id).sort(), [
    "agent-long",
    "hack-long",
  ]);
  assert.throws(() =>
    assertHackCanary({
      ...report,
      registrations: [
        ...report.registrations,
        {
          file: "trigger/keep-warm.ts",
          method: "schedules.task",
          id: "keep-warm",
        },
      ],
    }),
  );
  assert.throws(() =>
    assertHackCanary({
      ...report,
      registrations: report.registrations.slice(0, 1),
    }),
  );
});
