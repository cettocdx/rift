const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

function canaryInvocation(args, inheritedEnv) {
  if (
    new Set(args).size !== args.length ||
    args.some((arg) => !["--deploy", "--hack"].includes(arg))
  ) {
    throw new Error(
      "Usage: node scripts/trigger-staging-canary.cjs [--hack] [--deploy]",
    );
  }
  // Preserve local CLI login lookup and ordinary executable/temp resolution,
  // never application secrets, Trigger overrides, proxies or Node injection.
  const env = {};
  for (const name of [
    "HOME",
    "PATH",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "TZ",
    "TERM",
  ]) {
    if (inheritedEnv[name] !== undefined) env[name] = inheritedEnv[name];
  }
  env.NODE_ENV = "production";
  env.RIFT_TRIGGER_CANARY = "staging";
  return {
    cwd: path.resolve(__dirname, ".."),
    env,
    args: [
      path.resolve(
        path.dirname(require.resolve("trigger.dev/package.json")),
        "dist/esm/index.js",
      ),
      "deploy",
      ".",
      "--config",
      args.includes("--hack")
        ? "trigger.hack-canary.config.ts"
        : "trigger.canary.config.ts",
      "--project-ref",
      "proj_tzdasuzvmzpcjmlcafvs",
      "--env",
      "staging",
      "--env-file",
      "/dev/null",
      "--skip-update-check",
      "--skip-sync-env-vars",
      "--skip-promotion",
      ...(args.includes("--deploy") ? [] : ["--dry-run"]),
    ],
  };
}

function runCanary(inputArgs, inheritedEnv, spawn = spawnSync) {
  const { args, ...options } = canaryInvocation(inputArgs, inheritedEnv);
  // Depot pulls public base images and receives its upload credentials from
  // Trigger. It must not depend on this Mac's Docker Desktop credential helper
  // or forward unrelated registry credentials into the canary build.
  const dockerConfig = fs.mkdtempSync(
    path.join(os.tmpdir(), "rift-canary-docker-"),
  );
  try {
    fs.writeFileSync(
      path.join(dockerConfig, "config.json"),
      JSON.stringify({ auths: {} }),
      { mode: 0o600 },
    );
    options.env.DOCKER_CONFIG = dockerConfig;
    // A dry run still contacts Trigger and is deliberately never part of tests.
    return spawn(process.execPath, args, {
      ...options,
      stdio: "inherit",
    });
  } finally {
    fs.rmSync(dockerConfig, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const result = runCanary(process.argv.slice(2), process.env);
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Staging canary launcher failed.",
    );
    process.exitCode = 1;
  }
}

module.exports = { canaryInvocation, runCanary };
