import { resolveAgentAutoContinueReason } from "../auto-continue-policy";

const base = {
  purpose: "app" as const,
  temporary: false,
  stoppedDueToTokenExhaustion: false,
  stoppedDueToElapsedTimeout: false,
};

describe("resolveAgentAutoContinueReason", () => {
  it.each([
    { finishReason: "timeout", hardTimedOut: true, expected: "timeout" },
    {
      finishReason: "preemptive-timeout",
      stoppedDueToElapsedTimeout: true,
      expected: "preemptive-timeout",
    },
  ])(
    "continues a Build after $finishReason",
    ({ finishReason, hardTimedOut, stoppedDueToElapsedTimeout, expected }) => {
      expect(
        resolveAgentAutoContinueReason({
          ...base,
          finishReason,
          hardTimedOut,
          stoppedDueToElapsedTimeout:
            stoppedDueToElapsedTimeout ?? base.stoppedDueToElapsedTimeout,
        }),
      ).toBe(expected);
    },
  );

  it("auto-continues a Hack Workbench (security) run after a timeout", () => {
    expect(
      resolveAgentAutoContinueReason({
        ...base,
        purpose: "security",
        finishReason: "preemptive-timeout",
        stoppedDueToElapsedTimeout: true,
      }),
    ).toBe("preemptive-timeout");
  });

  it.each(["image"] as const)(
    "does not auto-continue time limits for %s runs",
    (purpose) => {
      expect(
        resolveAgentAutoContinueReason({
          ...base,
          purpose,
          finishReason: "preemptive-timeout",
          stoppedDueToElapsedTimeout: true,
        }),
      ).toBeNull();
    },
  );

  it.each([
    { manuallyAborted: true },
    { terminalError: true },
    { temporary: true },
  ])("does not continue unsafe terminal state %#", (override) => {
    expect(
      resolveAgentAutoContinueReason({
        ...base,
        ...override,
        finishReason: "preemptive-timeout",
        stoppedDueToElapsedTimeout: true,
      }),
    ).toBeNull();
  });

  it("preserves bounded Agent continuation for context and step limits", () => {
    expect(
      resolveAgentAutoContinueReason({
        ...base,
        purpose: "security",
        stoppedDueToTokenExhaustion: true,
      }),
    ).toBe("context-limit");
    expect(
      resolveAgentAutoContinueReason({
        ...base,
        purpose: "image",
        finishReason: "tool-calls",
      }),
    ).toBe("tool-calls");
  });

  it("does not continue budget, doom-loop, stop, or provider-error finishes", () => {
    for (const finishReason of [
      "budget-exhausted",
      "doom-loop",
      "stop",
      "error",
    ]) {
      expect(
        resolveAgentAutoContinueReason({ ...base, finishReason }),
      ).toBeNull();
    }
  });
});

it.each(["tool-calls", "preemptive-timeout", "timeout"])(
  "never restarts an approval-stopped run after %s",
  (finishReason) => {
    expect(
      resolveAgentAutoContinueReason({
        ...base,
        finishReason,
        stoppedDueToTokenExhaustion: true,
        stoppedDueToElapsedTimeout: true,
        approvalStopped: true,
      }),
    ).toBeNull();
  },
);
