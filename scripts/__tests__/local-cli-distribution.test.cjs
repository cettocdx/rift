const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");

test("the downloadable local CLI contains every current runtime module", () => {
  const files = execFileSync(
    "tar",
    ["-tzf", path.join(root, "public/downloads/rift-cli.tgz")],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const source of fs
    .readdirSync(path.join(root, "packages/local/src"))
    .filter((name) => name.endsWith(".ts"))) {
    assert.ok(
      files.includes(`package/dist/${source.replace(/\.ts$/, ".js")}`),
      `archive is missing ${source}`,
    );
  }
});

const os = require("node:os");
const {
  buildLocalCli,
  sourceDigest,
  sha256,
} = require("../package-local-cli.cjs");

test("the recorded download matches its source inputs and archive bytes", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(root, "public/downloads/rift-cli.manifest.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.sourceSha256, sourceDigest());
  assert.ok(manifest.sourceInputs.includes("workspace/pnpm-lock.yaml"));
  assert.ok(manifest.sourceInputs.includes("workspace/pnpm-workspace.yaml"));
  assert.equal(
    manifest.archiveSha256,
    sha256(fs.readFileSync(path.join(root, "public/downloads/rift-cli.tgz"))),
  );
  assert.equal(
    manifest.version,
    require("../../packages/local/package.json").version,
  );
});

test("source-only packaging excludes stale dist, includes added modules, and is reproducible", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "rift-cli-package-test-"),
  );
  try {
    const fixture = path.join(temporary, "packages/local");
    fs.mkdirSync(fixture, { recursive: true });
    for (const name of [
      "package.json",
      "tsconfig.json",
      "README.md",
      "pnpm-lock.yaml",
      "src",
    ])
      fs.cpSync(
        path.join(root, "packages/local", name),
        path.join(fixture, name),
        { recursive: true },
      );
    fs.symlinkSync(
      path.join(root, "packages/local/node_modules"),
      path.join(fixture, "node_modules"),
      "junction",
    );
    fs.mkdirSync(path.join(fixture, "dist"));
    fs.writeFileSync(
      path.join(fixture, "dist/index.js"),
      'throw new Error("stale ignored dist");',
    );
    fs.writeFileSync(path.join(fixture, "dist/removed-module.js"), "obsolete");
    fs.writeFileSync(
      path.join(fixture, "src/extra-runtime.ts"),
      "export const packageProbe = true;\n",
    );
    const out = path.join(temporary, "downloads");
    const first = buildLocalCli({
      packageDirectory: fixture,
      outputDirectory: out,
    });
    assert.ok(first.files.includes("dist/extra-runtime.js"));
    assert.ok(!first.files.includes("dist/removed-module.js"));
    assert.ok(
      !first.files.some(
        (file) =>
          file.includes("__tests__") || file.startsWith("node_modules/"),
      ),
    );
    assert.equal(
      fs.readFileSync(path.join(fixture, "dist/index.js"), "utf8"),
      'throw new Error("stale ignored dist");',
    );
    const second = buildLocalCli({
      packageDirectory: fixture,
      outputDirectory: out,
      check: true,
    });
    assert.equal(second.archiveSha256, first.archiveSha256);
    fs.appendFileSync(
      path.join(fixture, "src/extra-runtime.ts"),
      "export const changed = true;\n",
    );
    assert.throws(
      () =>
        buildLocalCli({
          packageDirectory: fixture,
          outputDirectory: out,
          check: true,
        }),
      /stale/,
    );
    assert.equal(
      sha256(fs.readFileSync(path.join(out, "rift-cli.tgz"))),
      first.archiveSha256,
    );

    // Exercise the actual npm prepack hook in a temporary checkout layout.
    fs.mkdirSync(path.join(temporary, "scripts"));
    fs.copyFileSync(
      path.join(root, "scripts/package-local-cli.cjs"),
      path.join(temporary, "scripts/package-local-cli.cjs"),
    );
    fs.copyFileSync(
      path.join(root, "LICENSE"),
      path.join(temporary, "LICENSE"),
    );
    for (const name of ["pnpm-lock.yaml", "pnpm-workspace.yaml"])
      fs.copyFileSync(path.join(root, name), path.join(temporary, name));
    execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["pack", "--pack-destination", temporary],
      { cwd: fixture, stdio: "pipe" },
    );
    const pkg = JSON.parse(
      fs.readFileSync(path.join(fixture, "package.json"), "utf8"),
    );
    const direct = path.join(temporary, `${pkg.name}-${pkg.version}.tgz`);
    const files = execFileSync("tar", ["-tzf", direct], { encoding: "utf8" });
    assert.ok(files.includes("package/dist/command-worker.js"));
    assert.ok(files.includes("package/dist/extra-runtime.js"));
    assert.ok(!files.includes("removed-module.js"));
    assert.match(
      fs.readFileSync(path.join(fixture, "dist/index.js"), "utf8"),
      /commandReadiness: true/,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
