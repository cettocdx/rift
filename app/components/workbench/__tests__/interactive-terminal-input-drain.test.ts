import { jest } from "@jest/globals";
import { createTerminalInputDrain } from "../interactive-terminal-input-drain";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createTerminalInputDrain", () => {
  it("coalesces keystrokes received during an in-flight remote mutation", async () => {
    const first = deferred();
    const send = jest
      .fn<(data: string) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const onError = jest.fn();
    const drain = createTerminalInputDrain(send, onError);

    drain.push("a");
    drain.push("b");
    drain.push("c");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenNthCalledWith(1, "a");

    first.resolve();
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, "bc");
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops and drops buffered input after a remote failure", async () => {
    const failure = new Error("input failed");
    const send = jest.fn(async () => {
      throw failure;
    });
    const onError = jest.fn();
    const drain = createTerminalInputDrain(send, onError);

    drain.push("a");
    drain.push("b");
    await flushMicrotasks();
    drain.push("c");

    expect(send).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("drops pending input when stopped", async () => {
    const first = deferred();
    const send = jest.fn(async () => first.promise);
    const drain = createTerminalInputDrain(send, jest.fn());

    drain.push("a");
    drain.push("b");
    drain.stop();
    first.resolve();
    await flushMicrotasks();

    expect(send).toHaveBeenCalledTimes(1);
  });
});
