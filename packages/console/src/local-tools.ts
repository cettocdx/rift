import {
  readFile,
  writeFile,
  readdir,
  realpath,
  mkdir,
  stat,
} from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { LOCAL_TOOL_SCHEMAS } from "./local-tool-schema.js";
const OUTPUT_LIMIT = 60000;
// Explicit path test; symlinks cannot turn project file access into host access.
function assertWithin(root: string, path: string) {
  const part = relative(root, path);
  if (
    part === ".." ||
    part.startsWith("../") ||
    part.startsWith("..\\") ||
    isAbsolute(part)
  )
    throw new Error(
      "File is outside this project. Start rift from its directory.",
    );
}
async function projectPath(root: string, path: unknown, create = false) {
  if (typeof path !== "string" || !path || path.includes("\0"))
    throw new Error("Invalid path");
  const target = resolve(root, path);
  assertWithin(root, target);
  let cursor = target;
  while (true) {
    try {
      assertWithin(root, await realpath(cursor));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !create)
        throw error;
      const next = dirname(cursor);
      if (next === cursor) throw error;
      cursor = next;
    }
  }
  return target;
}
export async function executeLocalTool(
  cwd: string,
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  if (!Object.hasOwn(LOCAL_TOOL_SCHEMAS, name))
    throw new Error("Unknown local tool");
  const root = await realpath(cwd);
  signal.throwIfAborted();
  if (name === "run_command") {
    if (
      typeof input.command !== "string" ||
      !input.command.trim() ||
      input.command.length > 32000
    )
      throw new Error("Invalid command");
    const timeout = Math.min(
      120000,
      Math.max(1000, Number(input.timeout_ms) || 30000),
    );
    return new Promise((resolveResult, reject) => {
      const child = spawn(
        process.env.SHELL || "/bin/sh",
        ["-c", input.command as string],
        {
          cwd: root,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      let timedOut = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const kill = (sig: NodeJS.Signals) => {
        try {
          if (process.platform === "win32") child.kill(sig);
          else if (child.pid) process.kill(-child.pid, sig);
        } catch {}
      };
      const stop = () => {
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 1500);
        killTimer.unref();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeout);
      signal.addEventListener("abort", stop, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        signal.removeEventListener("abort", stop);
      };
      const append = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-OUTPUT_LIMIT);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", (error) => {
        cleanup();
        reject(error);
      });
      child.on("close", (code) => {
        cleanup();
        resolveResult(
          `${timedOut ? "Timed out. " : signal.aborted ? "Stopped. " : ""}Exit code: ${code}\n${output}`,
        );
      });
    });
  }
  const file = await projectPath(root, input.path, name === "write_file");
  signal.throwIfAborted();
  if (name === "list_files") {
    const entries = await readdir(file, { withFileTypes: true });
    return entries
      .slice(0, 1000)
      .map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`)
      .join("\n")
      .slice(0, OUTPUT_LIMIT);
  }
  if (name === "read_file") {
    if ((await stat(file)).size > 2 * 1024 * 1024)
      throw new Error(
        "File exceeds 2 MB; use a focused shell command to inspect it.",
      );
    const content = await readFile(file, "utf8");
    if (content.includes("\0"))
      throw new Error("Binary file cannot be read as text");
    const offset = Math.max(1, Number(input.offset) || 1),
      limit = Math.min(2000, Math.max(1, Number(input.limit) || 300));
    return content
      .split("\n")
      .slice(offset - 1, offset + limit - 1)
      .map((line, i) => `${offset + i}: ${line}`)
      .join("\n")
      .slice(0, OUTPUT_LIMIT);
  }
  if (name === "write_file") {
    if (
      typeof input.content !== "string" ||
      Buffer.byteLength(input.content) > 1024 * 1024
    )
      throw new Error("File content must be text below 1 MB");
    await mkdir(dirname(file), { recursive: true });
    await projectPath(root, input.path, true);
    signal.throwIfAborted();
    await writeFile(file, input.content);
    return `Wrote ${relative(root, file)}`;
  }
  if (
    typeof input.old_text !== "string" ||
    !input.old_text ||
    typeof input.new_text !== "string"
  )
    throw new Error("Provide exact old_text and new_text");
  if ((await stat(file)).size > 2 * 1024 * 1024)
    throw new Error("File exceeds 2 MB");
  const content = await readFile(file, "utf8");
  if (content.split(input.old_text).length !== 2)
    throw new Error("Match must occur exactly once; read the file again");
  signal.throwIfAborted();
  await writeFile(file, content.replace(input.old_text, input.new_text));
  return `Edited ${relative(root, file)}`;
}
