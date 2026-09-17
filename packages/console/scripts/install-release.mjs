// Install/update an extracted release. Checks integrity before replacing the binary.
import {
  readFile,
  mkdir,
  copyFile,
  rename,
  chmod,
  lstat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const source = resolve(
  process.argv[2] || dirname(fileURLToPath(import.meta.url)),
);
const manifest = JSON.parse(
  await readFile(join(source, "manifest.json"), "utf8"),
);
if (
  manifest.name !== "rift" ||
  manifest.platform !== `${process.platform}-${process.arch}`
)
  throw new Error("Release platform does not match this computer");
const binary = join(source, "rift");
if (
  createHash("sha256")
    .update(await readFile(binary))
    .digest("hex") !== manifest.sha256
)
  throw new Error("Release checksum mismatch; nothing was installed");
const destDir =
  process.env.RIFT_CONSOLE_BIN_DIR || join(homedir(), ".local", "bin");
await mkdir(destDir, { recursive: true });
const dest = join(destDir, "rift");
let exists = false;
try {
  await lstat(dest);
  exists = true;
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (exists && !process.argv.includes("--replace"))
  throw new Error(
    "rift already exists; pass --replace to save a backup and update it",
  );
const temp = join(destDir, `.rift-${process.pid}.new`);
await copyFile(binary, temp);
await chmod(temp, 0o755);
if (exists) await copyFile(dest, `${dest}.previous`);
await rename(temp, dest);
console.log(`Installed RIFT ${manifest.version}: ${dest}`);
console.log(`Ensure ${destDir} is on PATH. Run rift login, then rift.`);
