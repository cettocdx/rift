#!/usr/bin/env node
// Install only the generated archive's declared JS dependencies in a fresh home.
// Runtime probes block network and child processes; no token or runner starts.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function smokeLocalCli(
  archive = path.join(root, "public/downloads/rift-cli.tgz"),
) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "rift-cli-smoke-"));
  try {
    const home = path.join(temporary, "home");
    fs.mkdirSync(home);
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      TMPDIR: home,
      NO_COLOR: "1",
      RIFT_LOCAL_TOKEN: "",
    };
    fs.writeFileSync(
      path.join(temporary, "package.json"),
      JSON.stringify({
        name: "rift-cli-isolated-smoke",
        version: "1.0.0",
        private: true,
      }),
    );
    execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "install",
        "--ignore-scripts",
        "--omit=optional",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        path.resolve(archive),
      ],
      { cwd: temporary, env, stdio: "pipe", timeout: 180000 },
    );
    const guard = path.join(temporary, "read-only-runtime.cjs");
    fs.writeFileSync(
      guard,
      `
const denied = () => { throw new Error('Smoke probe attempted network or process execution'); };
require('node:net').Socket.prototype.connect = denied;
globalThis.fetch = denied;
for (const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) require('node:child_process')[key] = denied;
`,
    );
    const installed = path.join(temporary, "node_modules/rift-cli");
    const run = (args, expectedStatus) => {
      const result = spawnSync(
        process.execPath,
        ["--require", guard, ...args],
        {
          cwd: home,
          env,
          encoding: "utf8",
          timeout: 15000,
        },
      );
      if (result.error || result.status !== expectedStatus)
        throw new Error(
          `Isolated CLI probe failed: ${result.error?.message || result.stderr || result.stdout}`,
        );
      return result.stdout + result.stderr;
    };
    const help = run([path.join(installed, "dist/index.js"), "--help"], 0);
    if (
      !help.includes("RIFT Local Sandbox Client") ||
      !help.includes("--keep-alive")
    )
      throw new Error("Archive help does not describe the current receiver");
    const missingToken = run([path.join(installed, "dist/index.js")], 1);
    if (!missingToken.includes("No authentication token provided"))
      throw new Error("Unauthenticated startup did not stop before connecting");
    // The worker is loaded via a dynamic path, so --help alone does not cover it.
    const modules = [
      "managed-session",
      "command-worker",
      "output-delivery",
      "idle-tracker",
      "process-runner",
      "utils",
    ];
    run(
      [
        "-e",
        modules
          .map(
            (name) =>
              `require(${JSON.stringify(path.join(installed, "dist", `${name}.js`))});`,
          )
          .join("\n"),
      ],
      0,
    );
    const index = fs.readFileSync(
      path.join(installed, "dist/index.js"),
      "utf8",
    );
    if (!/commandReadiness:\s*true/.test(index))
      throw new Error("Archive is missing receiver command readiness");
    return {
      help: true,
      unauthenticatedStartup: true,
      runtimeModules: modules.length,
      optionalPtyInstalled: fs.existsSync(
        path.join(temporary, "node_modules/node-pty"),
      ),
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
module.exports = { smokeLocalCli };
if (require.main === module) {
  try {
    console.log(JSON.stringify(smokeLocalCli(process.argv[2]), null, 2));
  } catch (error) {
    if (error.stdout) process.stderr.write(error.stdout);
    console.error(error.message);
    process.exitCode = 1;
  }
}
