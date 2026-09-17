/** @jest-environment node */
jest.mock("@e2b/code-interpreter", () => ({
  CommandExitError: class CommandExitError extends Error {
    constructor(result: object) {
      super("command exited");
      this.name = "CommandExitError";
      Object.assign(this, result);
    }
  },
}));
import { CommandExitError } from "@e2b/code-interpreter";
import type { AnySandbox } from "@/types";
import { BackgroundProcessTracker } from "../background-process-tracker";

const fixture = () => {
  const tracker = new BackgroundProcessTracker();
  tracker.addProcess(123, "generate report", ["report.txt"]);
  const run = jest.fn();
  const sandbox = { commands: { run } } as unknown as AnySandbox;
  return { tracker, run, sandbox };
};

test("a lost status response retains the process and rejects the observation", async () => {
  const { tracker, run, sandbox } = fixture();
  const failure = new Error("transport lost");
  run.mockRejectedValue(failure);
  await expect(tracker.checkProcessStatus(sandbox, 123)).rejects.toBe(failure);
  expect(tracker.getTrackedProcesses()).toHaveLength(1);
});

test("file readiness does not report idle when process observation failed", async () => {
  const { tracker, run, sandbox } = fixture();
  run.mockRejectedValue(new Error("offline"));
  await expect(
    tracker.hasActiveProcessesForFiles(sandbox, ["report.txt"]),
  ).rejects.toThrow("offline");
  expect(tracker.getTrackedProcesses()).toHaveLength(1);
});

test.each([
  { exitCode: 0, stdout: "9123\n", stderr: "" },
  { exitCode: 0, stdout: "", stderr: "" },
  { exitCode: 2, stdout: "", stderr: "permission denied" },
  { exitCode: 1, stdout: "", stderr: "ps: not found" },
  { exitCode: null, stdout: "", stderr: "" },
])("ambiguous ps result preserves the tracked process: %j", async (result) => {
  const { tracker, run, sandbox } = fixture();
  run.mockResolvedValue(result);
  await expect(tracker.checkProcessStatus(sandbox, 123)).rejects.toThrow();
  expect(tracker.getTrackedProcesses()).toHaveLength(1);
});

test("exact PID output confirms presence", async () => {
  const { tracker, run, sandbox } = fixture();
  run.mockResolvedValue({ exitCode: 0, stdout: " 123\n", stderr: "" });
  await expect(tracker.checkProcessStatus(sandbox, 123)).resolves.toBe(true);
  expect(run).toHaveBeenCalledWith("ps -p 123 -o pid=", {});
});

test("explicit empty exit-one result confirms absence", async () => {
  const { tracker, run, sandbox } = fixture();
  run.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
  await expect(tracker.checkProcessStatus(sandbox, 123)).resolves.toBe(false);
  expect(tracker.getTrackedProcesses()).toHaveLength(0);
});

test.each([NaN, -1, 0, 1.5, Infinity])(
  "rejects invalid PID %s before running a command",
  async (pid) => {
    const { tracker, run, sandbox } = fixture();
    await expect(tracker.checkProcessStatus(sandbox, pid)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  },
);

test("SDK exit-one absence receipt confirms removal", async () => {
  const { tracker, run, sandbox } = fixture();
  run.mockRejectedValue(
    new CommandExitError({
      exitCode: 1,
      stdout: "",
      stderr: "",
      error: "exit status 1",
    }),
  );
  await expect(tracker.checkProcessStatus(sandbox, 123)).resolves.toBe(false);
  expect(tracker.getTrackedProcesses()).toHaveLength(0);
});

test.each(["independent.png", "myreport.txt", "report.txt.bak"])(
  "unrelated background work does not block download of %s",
  async (file) => {
    const { tracker, run, sandbox } = fixture();
    run.mockRejectedValue(new Error("offline"));
    await expect(
      tracker.hasActiveProcessesForFiles(sandbox, [file]),
    ).resolves.toEqual({ active: false, processes: [] });
    expect(run).not.toHaveBeenCalled();
    expect(tracker.getTrackedProcesses()).toHaveLength(1);
  },
);
