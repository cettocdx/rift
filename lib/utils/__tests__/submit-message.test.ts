/** @jest-environment jsdom */
import { onSubmitChatMessage, submitChatMessage } from "../submit-message";

it("does not claim acceptance without a mounted chat", async () => {
  expect(await submitChatMessage("answer")).toBe(false);
  expect(await submitChatMessage("  ")).toBe(false);
});

it("waits for acceptance and only one subscriber dispatches", async () => {
  let accept!: (value: boolean) => void;
  const first = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        accept = resolve;
      }),
  );
  const second = jest.fn(() => true);
  const off1 = onSubmitChatMessage(first);
  const off2 = onSubmitChatMessage(second);
  try {
    const result = submitChatMessage(" answer ");
    const settled = jest.fn();
    void result.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledWith("answer");
    expect(second).not.toHaveBeenCalled();
    accept(true);
    expect(await result).toBe(true);
  } finally {
    off1();
    off2();
  }
});

it.each(["throw", "reject", "false", "void"])(
  "reports %s without an unhandled rejection",
  async (mode) => {
    const off = onSubmitChatMessage(() => {
      if (mode === "throw") throw new Error("offline");
      if (mode === "reject") return Promise.reject(new Error("offline"));
      if (mode === "false") return false;
    });
    try {
      expect(await submitChatMessage("answer")).toBe(false);
    } finally {
      off();
    }
  },
);
