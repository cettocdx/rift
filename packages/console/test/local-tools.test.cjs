const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const modules = Promise.all([
  import("../dist/local-tools.js"),
  import("../dist/local-tool-schema.js"),
]);
test("local tools read, uniquely edit and run a real command in the project", async () => {
  const [{ executeLocalTool: run }] = await modules;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rift-local-test-"));
  const signal = new AbortController().signal;
  try {
    await run(
      dir,
      "write_file",
      { path: "a.txt", content: "keep\nold\n" },
      signal,
    );
    await run(
      dir,
      "edit_file",
      { path: "a.txt", old_text: "old", new_text: "new" },
      signal,
    );
    assert.equal(
      await fs.readFile(path.join(dir, "a.txt"), "utf8"),
      "keep\nnew\n",
    );
    assert.match(
      await run(dir, "read_file", { path: "a.txt" }, signal),
      /2: new/,
    );
    assert.match(
      await run(dir, "run_command", { command: "pwd" }, signal),
      new RegExp(dir.replace("/var/", "/(?:private/)?var/")),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("file tools reject traversal and symlink escapes; ambiguous edits leave file unchanged", async () => {
  const [{ executeLocalTool: run }] = await modules;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rift-boundary-"));
  const signal = new AbortController().signal;
  try {
    await assert.rejects(
      run(dir, "read_file", { path: "../secret" }, signal),
      /outside/,
    );
    await fs.symlink(os.tmpdir(), path.join(dir, "escape"));
    await assert.rejects(
      run(dir, "write_file", { path: "escape/no.txt", content: "no" }, signal),
      /outside/,
    );
    await fs.writeFile(path.join(dir, "a"), "xx");
    await assert.rejects(
      run(
        dir,
        "edit_file",
        { path: "a", old_text: "x", new_text: "z" },
        signal,
      ),
      /exactly once/,
    );
    assert.equal(await fs.readFile(path.join(dir, "a"), "utf8"), "xx");
    await assert.rejects(run(dir, "toString", {}, signal), /Unknown/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("approval policy never auto-approves commands in edit-only mode", async () => {
  const [, { localToolNeedsApproval: needs }] = await modules;
  assert.equal(needs("ask", "read_file"), false);
  assert.equal(needs("ask", "write_file"), true);
  assert.equal(needs("auto", "edit_file"), false);
  assert.equal(needs("auto", "run_command"), true);
  assert.equal(needs("full", "run_command"), false);
  assert.equal(needs("unknown", "run_command"), true);
});
test("Stop terminates a running shell promptly", async () => {
  const [{ executeLocalTool: run }] = await modules;
  const c = new AbortController();
  const start = Date.now();
  const p = run(os.tmpdir(), "run_command", { command: "sleep 30" }, c.signal);
  setTimeout(() => c.abort(), 80);
  assert.match(await p, /Stopped/);
  assert.ok(Date.now() - start < 3000);
});
test("terminal repaint emits only changed lines, and clears on resize", async () => {
  const { TerminalScreen } = await import("../dist/screen.js");
  const screen = new TerminalScreen();
  assert.match(screen.paint("one\r\ntwo", 80), /\x1b\[2J/);
  assert.equal(screen.paint("one\r\ntwo", 80), "");
  assert.equal(screen.paint("one\r\nnew", 80), "\x1b[2;1Hnew");
  assert.match(screen.paint("one\r\nnew", 90), /\x1b\[2J/);
});
