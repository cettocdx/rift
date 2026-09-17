import { mkdir, lstat, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory =
  process.env.RIFT_CONSOLE_BIN_DIR || join(homedir(), ".local", "bin");
const bun = process.env.RIFT_BUN_PATH || join(homedir(), ".bun", "bin", "bun");
await lstat(bun).catch(() => { throw new Error("Bun is required. Install Bun or set RIFT_BUN_PATH to its executable."); });
const marker = "# RIFT independent console launcher";
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const wrapper = `#!/bin/sh\n${marker}\nexec ${quote(bun)} ${quote(join(root, "dist", "index.js"))} "$@"\n`;
await mkdir(directory, { recursive: true });
const commands = [];
for (const name of ["rift", "rift-console"]) {
  const destination = join(directory, name);
  try {
    const stat = await lstat(destination);
    if (
      !stat.isFile() ||
      !/# RIFT (paired|independent) console launcher/.test(await readFile(destination, "utf8"))
    ) {
      if (name === "rift" && process.argv.includes("--replace-rift")) {
        const backup = `${destination}.backup-${Date.now()}`;
        await rename(destination, backup);
        console.log(`Previous command saved at ${backup}`);
      } else if (name === "rift") {
        console.log(`Preserving existing ${destination}; use rift-console.`);
        continue;
      }
      else throw new Error(
        `Refusing to replace an existing command: ${destination}`,
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  commands.push(name);
}
for (const name of commands)
  await writeFile(join(directory, name), wrapper, { mode: 0o755 });
console.log(`Installed ${commands.join(" and ")} in ${directory}`);
console.log(
  "The launcher uses this checkout and its installed OpenTUI dependencies and Bun runtime.",
);
