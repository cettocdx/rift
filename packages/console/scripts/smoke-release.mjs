import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const source = join(
  root,
  "release",
  `rift-${pkg.version}-${process.platform}-${process.arch}`,
);
const temp = await mkdtemp(join(tmpdir(), "rift-release-"));
try {
  const bundle = join(temp, "bundle");
  await cp(source, bundle, { recursive: true });
  const bin = join(temp, "bin");
  const config = join(temp, "config");
  await mkdir(config);
  const env = {
    ...process.env,
    RIFT_CONFIG_DIR: config,
    RIFT_API_KEY: "",
    RIFT_APP_URL: "https://riftsys.app",
    RIFT_CONSOLE_BIN_DIR: bin,
  };
  const install = (extra = []) =>
    execFileSync(
      process.execPath,
      [join(bundle, "install.mjs"), bundle, ...extra],
      { cwd: temp, env, encoding: "utf8" },
    );
  install();
  const executable = join(bin, "rift");
  assert.match(
    execFileSync(executable, ["--help"], { cwd: temp, env, encoding: "utf8" }),
    /OpenTUI/,
  );
  const report = JSON.parse(
    execFileSync(executable, ["--json", "doctor"], {
      cwd: temp,
      env,
      encoding: "utf8",
    }),
  );
  assert.equal(report.auth.source, "missing");
  assert.equal(report.runtime, "bun");
  assert.equal(report.appUrl, "https://riftsys.app/");
  const original = await readFile(executable);
  install(["--replace"]);
  assert.deepEqual(await readFile(`${executable}.previous`), original);
  await writeFile(join(bundle, "rift"), "corrupted");
  assert.throws(() => install(["--replace"]));
  assert.deepEqual(await readFile(executable), original);
  console.log(
    "PASS: clean standalone install, help, isolated auth, update backup, tamper rejection",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
