import { HackDispatchState } from "../hack-dispatch-state";
it("deduplicates pending Stop and fences new sends until acknowledgment", async () => {
  const state = new HackDispatchState();
  state.begin("one");
  let resolve!: () => void;
  const operation = jest.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const first = state.cancel("other", operation);
  expect(state.cancel("newer", operation)).toBe(first);
  expect(() => state.begin("two")).toThrow("Confirm");
  await Promise.resolve();
  expect(operation).toHaveBeenCalledTimes(1);
  expect(operation).toHaveBeenCalledWith("one");
  resolve();
  await first;
  state.begin("two");
  expect(state.getSnapshot()).toEqual({
    status: "idle",
    dispatchId: "two",
    transport: "durable",
  });
});
it("does not let a late context replace the stopped request", async () => {
  const state = new HackDispatchState();
  state.begin("one");
  await expect(
    state.cancel(undefined, async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  state.restore("one", "two");
  expect(state.getSnapshot()).toMatchObject({
    status: "failed",
    dispatchId: "one",
    stoppingDispatchId: "one",
  });
});

it("retains the original producer kind while cancellation is uncertain", async () => {
  const state = new HackDispatchState();
  await expect(
    state.cancel(
      "legacy-message",
      async () => {
        throw new Error("offline");
      },
      "legacy",
    ),
  ).rejects.toThrow("offline");
  expect(state.getSnapshot().stopTransport).toBe("legacy");
  await state.cancel("newer-message", async () => {}, "durable");
  expect(state.getSnapshot().stopTransport).toBe("legacy");
});
