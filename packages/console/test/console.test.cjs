const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { resolve } = require("node:path");
const { stripVTControlCharacters } = require("node:util");
const { snapshot } = require("./fixture.cjs");

test("natural-language messages use the active chat and only supported settings resolve", async () => {
  const { parseConsoleInput } = await import("../dist/commands.js");
  assert.deepEqual(parseConsoleInput("Build a timer", snapshot()), {
    kind: "command",
    command: { type: "submit", text: "Build a timer", chatId: "chat-one" },
  });
  assert.deepEqual(parseConsoleInput("/model Model A", snapshot()), {
    kind: "command",
    command: { type: "set-model", value: "model-a" },
  });
  assert.equal(parseConsoleInput("/effort", snapshot()).kind, "menu");
  assert.equal(parseConsoleInput("/model imaginary", snapshot()).kind, "error");
  assert.equal(
    parseConsoleInput("/permissions", snapshot()).choices[0].value,
    "ask",
  );
});
test("approval selection cannot be bypassed by command arguments or defaults", async () => {
  const { parseConsoleInput } = await import("../dist/commands.js");
  const approval = parseConsoleInput("/approve", snapshot());
  assert.equal(approval.kind, "approval");
  assert.equal(approval.choices[0].preview, "Write app.ts");
  assert.equal(
    parseConsoleInput("/approve approval-one", snapshot()).kind,
    "error",
  );
  assert.equal(
    parseConsoleInput("/approve", { ...snapshot(), approvals: [] }).kind,
    "error",
  );
});
test("disconnected consoles permit local help but no app writes", async () => {
  const { parseConsoleInput } = await import("../dist/commands.js");
  assert.equal(parseConsoleInput("/help", null).kind, "local");
  assert.equal(parseConsoleInput("/stop", null).kind, "error");
  assert.equal(
    parseConsoleInput("Hello", { ...snapshot(), status: "unavailable" }).kind,
    "error",
  );
  assert.deepEqual(
    parseConsoleInput("/new", { ...snapshot(), status: "unavailable" }),
    { kind: "command", command: { type: "new-chat" } },
  );
  assert.equal(parseConsoleInput("/new", null).kind, "error");
});
test("terminal output strips ANSI, OSC clipboard commands, C1 and bidi overrides", async () => {
  const { sanitizeTerminalText } = await import("../dist/renderer.js");
  const raw =
    "Hello\x1b[31m red\x1b[0m\x1b]52;c;secret\x07\x9b2J\u202eevil\x00";
  const safe = sanitizeTerminalText(raw);
  assert.doesNotMatch(safe, /[\x00-\x08\x1b\x7f-\x9f\u202e]/);
  assert.doesNotMatch(safe, /secret/);
  assert.match(safe, /Hello red/);
});
test("frames fit terminal width and use current target independently from terminal folder", async () => {
  const { renderFrame, terminalWidth } = await import("../dist/renderer.js");
  for (const [columns, rows] of [
    [117, 41],
    [80, 24],
    [32, 16],
  ]) {
    const frame = renderFrame({
      columns,
      rows,
      snapshot: snapshot(),
      connected: true,
      cwd: "/tmp/mac-folder",
      input: "Build a clean 日本語 UI",
      color: true,
    });
    const plain = stripVTControlCharacters(frame);
    assert.ok(plain.split("\r\n").length <= rows);
    for (const line of plain.split("\r\n"))
      assert.ok(terminalWidth(line) <= columns, `overflow: ${line}`);
    assert.match(plain, /Cloud/);
    assert.match(plain, /╭/);
  }
});
test("active transcript drops welcome branding and escapes model output", async () => {
  const { renderFrame } = await import("../dist/renderer.js");
  const state = {
    ...snapshot(),
    entries: [{ id: "msg", kind: "assistant", text: "Ready\x1b]0;evil\x07" }],
  };
  const plain = stripVTControlCharacters(
    renderFrame({
      columns: 80,
      rows: 24,
      snapshot: state,
      connected: true,
      cwd: "/tmp",
      input: "",
      color: false,
    }),
  );
  assert.doesNotMatch(plain, /R I F T|evil|Recursive/);
  assert.match(plain, /Ready/);
});
test("long approval previews are paged completely with an explicit More/End indicator", async () => {
  const { previewPage, renderFrame } = await import("../dist/renderer.js");
  const preview = Array.from(
    { length: 20 },
    (_, index) => `Action detail ${index + 1}`,
  ).join("\n");
  assert.equal(previewPage(preview, 80, 24).atEnd, false);
  const final = previewPage(preview, 80, 24, 999);
  assert.equal(final.atEnd, true);
  assert.equal(final.lines.at(-1), "Action detail 20");
  const frame = (offset) =>
    stripVTControlCharacters(
      renderFrame({
        columns: 80,
        rows: 30,
        snapshot: snapshot(),
        connected: true,
        cwd: "/tmp",
        input: "",
        color: false,
        menu: {
          title: "Write file",
          rows: ["Cancel", "Allow this action once"],
          selected: 0,
          preview,
          previewOffset: offset,
        },
      }),
    );
  assert.match(frame(0), /More below/);
  assert.match(frame(999), /Action detail 20/);
  assert.match(frame(999), /End/);
  assert.match(frame(999), /Model A \(High\) · Ask first/);
});
test("bracketed paste including split markers inserts text without submitting", async () => {
  const { createTerminalInput } = await import("../dist/input.js");
  const keys = [],
    pastes = [];
  const keyboard = createTerminalInput(
    (text, key) => keys.push({ text, key }),
    (text) => pastes.push(text),
  );
  keyboard.write("\x1b[20");
  keyboard.write("0~first\nsecond\x1b[2");
  keyboard.write("01~");
  assert.deepEqual(pastes, ["first\nsecond"]);
  assert.deepEqual(keys, []);
  keyboard.write("\r");
  assert.equal(keys[0].key.name, "return");
  keyboard.write("\n");
  assert.equal(keys[1].key.name, "enter");
  keyboard.close();
});
test("installed entrypoint help and JSON doctor work outside the repository", () => {
  const entry = resolve(__dirname, "../dist/index.js");
  const help = execFileSync(process.execPath, [entry, "--help"], {
    cwd: "/tmp",
    encoding: "utf8",
  });
  assert.match(help, /RIFT Terminal/);
  assert.match(help, /\/approve/);
  const doctor = JSON.parse(
    execFileSync(process.execPath, [entry, "--json", "doctor"], {
      cwd: "/tmp",
      encoding: "utf8",
    }),
  );
  assert.equal(doctor.ok, true);
  assert.ok(
    ["environment", "saved-personal-key", "missing"].includes(
      doctor.auth.source,
    ),
  );
  assert.equal(doctor.harness, "local-tool-loop");
  assert.equal(doctor.auth.paired, false);
});

test("live console mark pulses without changing shape and stops for approval or completion", async () => {
  const { renderFrame } = await import("../dist/renderer.js");
  const { RIFT_ACTIVITY_MARK } = await import("../dist/activity-orb.js");
  const options = {
    columns: 80,
    rows: 24,
    connected: true,
    cwd: "/tmp",
    input: "",
    color: true,
    snapshot: {
      ...snapshot(),
      status: "streaming",
      approvals: [],
      entries: [
        { id: "reply", kind: "assistant", text: "Preparing the workspace" },
      ],
    },
  };
  const first = renderFrame({ ...options, animationTime: 0 });
  const next = renderFrame({ ...options, animationTime: 800 });
  assert.notEqual(first, next, "activity changes brightness");
  assert.equal(
    stripVTControlCharacters(first),
    stripVTControlCharacters(next),
    "silhouette and transcript stay fixed",
  );
  for (const row of RIFT_ACTIVITY_MARK)
    assert.ok(stripVTControlCharacters(first).includes(row));
  assert.match(stripVTControlCharacters(first), /Working/);
  for (const current of [
    snapshot(),
    { ...snapshot(), status: "ready", approvals: [] },
  ]) {
    assert.doesNotMatch(
      stripVTControlCharacters(
        renderFrame({
          ...options,
          snapshot: { ...current, entries: options.snapshot.entries },
          animationTime: 80,
        }),
      ),
      /[\u2800-\u28ff]/,
    );
  }
});

test("typing preempts decorative frames and streaming updates coalesce", async (t) => {
  const { FrameScheduler } = await import("../dist/frame-scheduler.js");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let frames = 0;
  const scheduler = new FrameScheduler(() => frames++);
  scheduler.animateAfter(350);
  scheduler.request(16);
  scheduler.request(0);
  t.mock.timers.tick(0);
  assert.equal(frames, 1, "input paints without waiting for animation");
  for (let i = 0; i < 200; i++) scheduler.request(16);
  t.mock.timers.tick(16);
  assert.equal(frames, 2, "a stream burst generates a single frame");
  scheduler.close();
  t.mock.timers.tick(1000);
  assert.equal(frames, 2);
});

test("off-screen history is not laid out on each keystroke", async () => {
  const { renderView } = await import("../dist/renderer.js");
  const old = {
    id: "old",
    kind: "assistant",
    get text() {
      throw new Error("off-screen history rendered");
    },
  };
  const state = {
    ...snapshot(),
    approvals: [],
    entries: [
      old,
      { id: "visible", kind: "assistant", text: "visible\n".repeat(100) },
    ],
  };
  const result = renderView({
    columns: 80,
    rows: 24,
    connected: true,
    snapshot: state,
    cwd: "/tmp",
    input: "abc",
    inputCursor: 1,
  });
  assert.ok(result.cursor.row > 0 && result.cursor.row < 24);
  assert.equal(result.cursor.column, 7);
  assert.doesNotMatch(result.frame, /▏/);
});

test("multiline input keeps the cursor in view when moving back to its start", async () => {
  const { renderView } = await import("../dist/renderer.js");
  const state = { ...snapshot(), approvals: [], target: "local", entries: [] };
  const result = renderView({
    columns: 80,
    rows: 24,
    connected: true,
    snapshot: state,
    cwd: "/tmp",
    input: "first\nsecond\nthird\nfourth\nfifth",
    inputCursor: 0,
  });
  const plain = stripVTControlCharacters(result.frame);
  assert.match(plain, /first/);
  assert.doesNotMatch(plain, /fifth/);
  assert.equal(result.cursor.column, 6);
  assert.match(plain.split("\r\n")[result.cursor.row - 1], /first/);
});

test("tool details are available without flooding the normal transcript", async () => {
  const { renderFrame } = await import("../dist/renderer.js");
  const options = {
    columns: 100,
    rows: 30,
    connected: true,
    snapshot: {
      ...snapshot(),
      approvals: [],
      entries: [
        {
          id: "read",
          kind: "activity",
          text: "Read package.json",
          details: "full original output\nmore evidence",
        },
      ],
    },
    cwd: "/tmp",
    input: "",
  };
  assert.doesNotMatch(renderFrame(options), /full original output/);
  assert.match(
    renderFrame({ ...options, showDetails: true }),
    /full original output/,
  );
});
