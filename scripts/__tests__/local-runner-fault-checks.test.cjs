const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const {
  counterCommand,
  executionCount,
  assertOrderedMarkers,
  assertDisconnected,
  waitForExit,
  stopLauncher,
} = require("../local-runner-fault-checks.cjs");
test("two real shell executions are counted as two, including quoted paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rift-counter-test-"));
  try {
    const file = path.join(dir, "count's.txt");
    execFileSync("/bin/sh", ["-c", counterCommand(file)]);
    assert.equal(executionCount(file), 1);
    execFileSync("/bin/sh", ["-c", counterCommand(file)]);
    assert.equal(executionCount(file), 2);
    assert.equal(fs.readFileSync(file, "utf8"), "start\nstart\n");
    fs.writeFileSync(file, "start\\nstart\\n");
    assert.throws(() => executionCount(file), /Malformed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("output must contain exactly the expected markers in order", () => {
  assert.doesNotThrow(() => assertOrderedMarkers([0, 1, 2], 3));
  for (const markers of [
    [1, 2, 3],
    [0, 2, 1],
    [0, 1, 1],
    [0, 1],
    [0, 1, 2, 3],
  ])
    assert.throws(() => assertOrderedMarkers(markers, 3), /SEQUENCE/);
});
test("false or missing disconnect acknowledgement fails cleanup", () => {
  assert.doesNotThrow(() => assertDisconnected({ success: true }));
  for (const response of [{ success: false }, {}, undefined])
    assert.throws(() => assertDisconnected(response), /DISCONNECT_FAILED/);
});
test("launcher waits have a deadline and remove listeners", async () => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
  });
  await assert.rejects(waitForExit(child, 5), /EXIT_TIMEOUT/);
  assert.equal(child.listenerCount("exit"), 0);
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL") {
      child.signalCode = signal;
      child.emit("exit");
    }
  };
  await stopLauncher(child, "SIGTERM", 5);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});
