import {
  createTerminalOutputDrain,
  TERMINAL_OUTPUT_BATCH_BYTES,
} from "../interactive-terminal-output-drain";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("renders bounded Unicode batches byte-for-byte and returns credit only after xterm completes", () => {
  const writes: { bytes: Uint8Array; done: () => void }[] = [];
  const failed = jest.fn();
  const drain = createTerminalOutputDrain(
    (bytes, done) => writes.push({ bytes, done }),
    failed,
  );
  const expected = "λ🙂\r\n".repeat(7000);
  const rendered = jest.fn();
  drain.push(expected, rendered);
  jest.runOnlyPendingTimers();
  expect(writes).toHaveLength(1);
  expect(writes[0].bytes).toEqual(new TextEncoder().encode(expected));
  expect(rendered).not.toHaveBeenCalled();
  jest.runOnlyPendingTimers();
  expect(writes).toHaveLength(1);
  writes[0].done();
  writes[0].done();
  expect(rendered).toHaveBeenCalledTimes(1);
  drain.push("next", rendered);
  jest.runOnlyPendingTimers();
  writes[1].done();
  expect(rendered).toHaveBeenCalledTimes(2);
  expect(failed).not.toHaveBeenCalled();
});

it.each(["while scheduled", "while parsing"])(
  "fails closed instead of buffering a producer %s",
  (phase) => {
    const write = jest.fn();
    const failed = jest.fn();
    const drain = createTerminalOutputDrain(write, failed);
    drain.push("first");
    if (phase === "while parsing") jest.runOnlyPendingTimers();
    for (let index = 0; index < 120000; index++) drain.push(`${index}\r\n`);
    jest.runAllTimers();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(write.mock.calls.length).toBeLessThanOrEqual(1);
  },
);

it("rejects oversized output before it enters the renderer", () => {
  const failed = jest.fn();
  const write = jest.fn();
  createTerminalOutputDrain(write, failed).push(
    "x".repeat(TERMINAL_OUTPUT_BATCH_BYTES + 1),
  );
  jest.runAllTimers();
  expect(write).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledTimes(1);
});

it("publishes exit after the last render and discards stale render callbacks after stop", () => {
  let acknowledge!: () => void;
  const drain = createTerminalOutputDrain((_bytes, done) => {
    acknowledge = done;
  }, jest.fn());
  const rendered = jest.fn();
  const finished = jest.fn();
  drain.push("in flight", rendered);
  jest.runOnlyPendingTimers();
  drain.finish(finished);
  expect(finished).not.toHaveBeenCalled();
  acknowledge();
  expect(rendered).toHaveBeenCalledTimes(1);
  expect(finished).toHaveBeenCalledTimes(1);
  const next = createTerminalOutputDrain((_bytes, done) => {
    acknowledge = done;
  }, jest.fn());
  next.push("stale", rendered);
  jest.runOnlyPendingTimers();
  next.stop();
  acknowledge();
  expect(rendered).toHaveBeenCalledTimes(1);
});

it("finishes empty output immediately and stops on renderer failure", () => {
  const completed = jest.fn();
  createTerminalOutputDrain(jest.fn(), jest.fn()).finish(completed);
  expect(completed).toHaveBeenCalledTimes(1);
  const error = new Error("disposed renderer");
  const failed = jest.fn();
  const drain = createTerminalOutputDrain(() => {
    throw error;
  }, failed);
  drain.push("text");
  drain.finish(completed);
  jest.runAllTimers();
  expect(failed).toHaveBeenCalledWith(error);
  expect(completed).toHaveBeenCalledTimes(1);
});
