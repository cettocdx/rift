import { settleAgentUiStream } from "../settle-agent-ui-stream";

const timeout = () =>
  Object.assign(
    new Error(
      "Max attempts (3) exhausted: Request timeout after 5000ms (4 records, 51216 bytes)",
    ),
    { name: "S2Error" },
  );

test("a delivery timeout waits for the source to finish instead of ending the task", async () => {
  let finish!: () => void;
  let settled = false;
  const source = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const result = settleAgentUiStream(Promise.reject(timeout()), source).then(
    (value) => {
      settled = true;
      return value;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  finish();
  await expect(result).resolves.toEqual({ deliveryInterrupted: true });
});

test("source failures are never hidden by a delivery failure", async () => {
  const failure = new Error("persistence failed");
  await expect(
    settleAgentUiStream(Promise.reject(timeout()), Promise.reject(failure)),
  ).rejects.toBe(failure);
});

test("unclassified delivery failures remain failures", async () => {
  const failure = new Error("invalid record");
  await expect(
    settleAgentUiStream(Promise.reject(failure), Promise.resolve()),
  ).rejects.toBe(failure);
});

test("normal delivery succeeds", async () => {
  await expect(
    settleAgentUiStream(Promise.resolve(), Promise.resolve()),
  ).resolves.toEqual({ deliveryInterrupted: false });
});

test("a failed upload branch preserves later events and persists exactly once", async () => {
  const { ReadableStream, WritableStream } = await import("node:stream/web");
  let controller!: import("node:stream/web").ReadableStreamDefaultController<number>;
  const source = new ReadableStream<number>({
    start(value) {
      controller = value;
    },
  });
  const [uploadBranch, modelBranch] = source.tee();
  const events: number[] = [];
  const persist = jest.fn();
  const consume = (async () => {
    const reader = modelBranch.getReader();
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      events.push(item.value);
    }
    persist(events);
  })();
  const upload = uploadBranch.pipeTo(
    new WritableStream({
      write() {
        throw timeout();
      },
    }),
  );
  const result = settleAgentUiStream(upload, consume);
  controller.enqueue(1);
  await Promise.resolve();
  controller.enqueue(2);
  controller.enqueue(3);
  controller.close();
  await expect(result).resolves.toEqual({ deliveryInterrupted: true });
  expect(events).toEqual([1, 2, 3]);
  expect(persist).toHaveBeenCalledTimes(1);
});
