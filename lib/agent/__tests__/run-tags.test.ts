import { ensureRunTags } from "../run-tags";

describe("worker tags already supplied by the dispatcher", () => {
  it("does not wait on the tag service when the run already has every tag", async () => {
    const add = jest.fn(() => new Promise<void>(() => {}));
    await ensureRunTags(
      ["user_a", "chat_b", "sub_max"],
      ["chat_b", "user_a", "sub_max"],
      add,
    );
    expect(add).not.toHaveBeenCalled();
  });
  it("still annotates direct or scheduled runs missing tags", async () => {
    const add = jest.fn(async () => {});
    await ensureRunTags(
      ["user_a", "chat_b", "sub_max"],
      ["user_a", "custom"],
      add,
    );
    expect(add).toHaveBeenCalledWith(["chat_b", "sub_max"]);
  });
});

it("does not fail the task when optional tag transport rejects", async () => {
  await expect(
    ensureRunTags(["chat_a"], [], async () => {
      throw new Error("offline");
    }),
  ).resolves.toBe("failed");
});
it("does not fail the task on a synchronous SDK exception", async () => {
  await expect(
    ensureRunTags(["chat_a"], [], () => {
      throw new Error("SDK unavailable");
    }),
  ).resolves.toBe("failed");
});
it("bounds tag latency and handles a rejection arriving after the deadline", async () => {
  jest.useFakeTimers();
  try {
    let reject!: (reason: Error) => void;
    const pending = new Promise<void>((_, rejectPromise) => {
      reject = rejectPromise;
    });
    const result = ensureRunTags(["chat_a"], [], () => pending);
    await jest.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toBe("deferred");
    reject(new Error("late network failure"));
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
it("clears its deadline after a successful tag update", async () => {
  jest.useFakeTimers();
  try {
    await expect(ensureRunTags(["chat_a"], [], async () => {})).resolves.toBe(
      "updated",
    );
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
