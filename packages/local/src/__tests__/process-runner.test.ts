/** @jest-environment node */
import { ProcessRunner } from "../process-runner";
const mockProcesses: Array<{
  exit?: (event: { exitCode: number }) => void;
  kill: jest.Mock;
}> = [];
const mockSpawn = jest.fn(() => {
  const process: {
    exit?: (event: { exitCode: number }) => void;
    kill: jest.Mock;
  } = { kill: jest.fn() };
  mockProcesses.push(process);
  return {
    pid: 123,
    write: jest.fn(),
    resize: jest.fn(),
    kill: process.kill,
    onData: jest.fn(),
    onExit: (listener: typeof process.exit) => {
      process.exit = listener;
    },
  };
});
jest.mock("node-pty", () => ({ spawn: () => mockSpawn() }), { virtual: true });
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockProcesses.length = 0;
});
afterEach(() => {
  jest.useRealTimers();
});
test("active PTYs remain visible to idle tracking until the last session exits", () => {
  const runner = new ProcessRunner();
  expect(runner.hasRunningProcesses()).toBe(false);
  runner.run("one", "work");
  runner.run("two", "work");
  expect(runner.hasRunningProcesses()).toBe(true);
  mockProcesses[0].exit?.({ exitCode: 0 });
  expect(runner.hasRunningProcesses()).toBe(true);
  mockProcesses[1].exit?.({ exitCode: 0 });
  expect(runner.hasRunningProcesses()).toBe(false);
  runner.dispose();
});
test("a duplicate live session ID cannot spawn a second process and orphan the first", () => {
  const runner = new ProcessRunner();
  runner.run("one", "work");
  expect(() => runner.run("one", "second-effect")).toThrow(/already running/i);
  expect(mockSpawn).toHaveBeenCalledTimes(1);
  runner.stop("one");
  expect(mockProcesses[0].kill).toHaveBeenCalledWith("SIGTERM");
  mockProcesses[0].exit?.({ exitCode: 0 });
  runner.dispose();
});
