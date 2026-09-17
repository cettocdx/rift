const fs = require("node:fs");
function counterCommand(file) {
  const quoted = `'${file.replaceAll("'", "'\\''")}'`;
  return `printf '%s\\n' start >> ${quoted}`;
}
function executionCount(file) {
  const content = fs.readFileSync(file, "utf8");
  if (!content) return 0;
  if (!/^(start\n)+$/.test(content))
    throw new Error("Malformed execution counter");
  return content.split("\n").length - 1;
}
function assertOrderedMarkers(markers, expectedCount) {
  if (
    markers.length !== expectedCount ||
    markers.some((value, index) => value !== index)
  )
    throw new Error("OUTPUT_SEQUENCE_MISMATCH");
}
function assertDisconnected(response) {
  if (response?.success !== true)
    throw new Error("QA_REGISTRATION_DISCONNECT_FAILED");
}
function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      child.off("exit", done);
      resolve();
    };
    const timer = setTimeout(() => {
      child.off("exit", done);
      reject(new Error("LAUNCHER_EXIT_TIMEOUT"));
    }, timeoutMs);
    child.once("exit", done);
  });
}
async function stopLauncher(child, signal = "SIGTERM", timeoutMs = 8000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  try {
    await waitForExit(child, timeoutMs);
  } catch {
    child.kill("SIGKILL");
    await waitForExit(child, 5000);
  }
}
module.exports = {
  counterCommand,
  executionCount,
  assertOrderedMarkers,
  assertDisconnected,
  waitForExit,
  stopLauncher,
};
