import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const platform = `${process.platform}-${process.arch}`;
if (
  !["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(platform)
)
  throw new Error("Unsupported release target");
const out = join(root, "release", `rift-${pkg.version}-${platform}`);
await mkdir(out, { recursive: true });
const bun = process.env.RIFT_BUN_PATH || "bun";
execFileSync(
  bun,
  [
    "build",
    "--compile",
    "--minify",
    "./src/index.ts",
    "--outfile",
    join(out, "rift"),
  ],
  { cwd: root, stdio: "inherit" },
);
const hash = createHash("sha256")
  .update(await readFile(join(out, "rift")))
  .digest("hex");
await writeFile(
  join(out, "manifest.json"),
  JSON.stringify(
    { name: "rift", version: pkg.version, platform, sha256: hash },
    null,
    2,
  ) + "\n",
);
await copyFile(join(root, "README.md"), join(out, "README.md"));
await copyFile(
  join(root, "scripts/install-release.mjs"),
  join(out, "install.mjs"),
);
execFileSync(
  "tar",
  ["-czf", `${out}.tar.gz`, "-C", dirname(out), out.split("/").at(-1)],
  { stdio: "inherit" },
);
console.log(`${out}.tar.gz`);
