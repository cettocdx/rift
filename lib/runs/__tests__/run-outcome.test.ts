import {
  BUDGET_EXHAUSTION_FINISH_REASON,
  DOOM_LOOP_FINISH_REASON,
  TOKEN_EXHAUSTION_FINISH_REASON,
} from "@/lib/chat/stop-conditions";
import {
  MAX_ERROR_LINE_LENGTH,
  RECONCILED_STOP_REASON,
  RUN_FAILED_LINE,
  RUN_FINISHED_LINE,
  RUN_RECONCILED_LINE,
  RUN_STOP_REASON_LINES,
  describeRunOutcome,
  resolveRunOutcome,
  type RunOutcomeInput,
} from "../run-outcome";

const QUIET: RunOutcomeInput = {
  isAborted: false,
  manuallyAborted: false,
  stoppedDueToElapsedTimeout: false,
  stoppedDueToDoomLoop: false,
  stoppedDueToBudgetExhaustion: false,
  stoppedDueToTokenExhaustion: false,
  terminalProviderError: false,
};

const EVERYTHING: RunOutcomeInput = {
  isAborted: true,
  manuallyAborted: true,
  stoppedDueToElapsedTimeout: true,
  stoppedDueToDoomLoop: true,
  stoppedDueToBudgetExhaustion: true,
  stoppedDueToTokenExhaustion: true,
  terminalProviderError: true,
  finishReason: TOKEN_EXHAUSTION_FINISH_REASON,
};

describe("resolveRunOutcome", () => {
  describe("each mapping on its own", () => {
    it("a person's Stop is cancelled, never failed", () => {
      expect(
        resolveRunOutcome({ ...QUIET, isAborted: true, manuallyAborted: true }),
      ).toEqual({
        status: "cancelled",
        stopReason: "user",
        reasonLine: "Stopped by you.",
      });
    });

    it("a terminal provider error is failed", () => {
      expect(
        resolveRunOutcome({ ...QUIET, terminalProviderError: true }),
      ).toEqual({
        status: "failed",
        stopReason: "provider_error",
        reasonLine: "The model provider returned an error.",
      });
    });

    it("a halted doom loop is completed_with_warnings, not completed", () => {
      // This is the case the old inline ternary got wrong: the run stopped
      // because the agent was spinning, and the row said "completed".
      expect(
        resolveRunOutcome({ ...QUIET, stoppedDueToDoomLoop: true }),
      ).toEqual({
        status: "completed_with_warnings",
        stopReason: "doom_loop",
        reasonLine:
          "Stopped: the agent repeated the same action without making progress.",
      });
    });

    it("budget exhaustion is completed_with_warnings", () => {
      expect(
        resolveRunOutcome({ ...QUIET, stoppedDueToBudgetExhaustion: true }),
      ).toEqual({
        status: "completed_with_warnings",
        stopReason: "budget",
        reasonLine: "Stopped: the usage budget for this run was exhausted.",
      });
    });

    it("the elapsed time limit is completed_with_warnings", () => {
      expect(
        resolveRunOutcome({ ...QUIET, stoppedDueToElapsedTimeout: true }),
      ).toEqual({
        status: "completed_with_warnings",
        stopReason: "time_limit",
        reasonLine: "Stopped at the run's time limit.",
      });
    });

    it("token exhaustion is completed_with_warnings / context_limit", () => {
      expect(
        resolveRunOutcome({ ...QUIET, stoppedDueToTokenExhaustion: true }),
      ).toEqual({
        status: "completed_with_warnings",
        stopReason: "context_limit",
        reasonLine: "Stopped at the context window limit.",
      });
    });

    it.each([
      [TOKEN_EXHAUSTION_FINISH_REASON, "context_limit"],
      [DOOM_LOOP_FINISH_REASON, "doom_loop"],
      [BUDGET_EXHAUSTION_FINISH_REASON, "budget"],
    ])(
      "recognises finishReason=%s when no flag was set (stopReason=%s)",
      (finishReason, stopReason) => {
        const outcome = resolveRunOutcome({ ...QUIET, finishReason });
        expect(outcome.status).toBe("completed_with_warnings");
        expect(outcome.stopReason).toBe(stopReason);
      },
    );

    it("a quiet finish is completed with no stop reason", () => {
      expect(resolveRunOutcome(QUIET)).toEqual({
        status: "completed",
        reasonLine: "Finished.",
      });
      expect(resolveRunOutcome(QUIET).stopReason).toBeUndefined();
    });

    it("an ordinary finishReason (stop, tool-calls) is still completed", () => {
      expect(resolveRunOutcome({ ...QUIET, finishReason: "stop" }).status).toBe(
        "completed",
      );
      expect(
        resolveRunOutcome({ ...QUIET, finishReason: "tool-calls" }).status,
      ).toBe("completed");
    });

    it("isAborted alone does not change the outcome", () => {
      expect(resolveRunOutcome({ ...QUIET, isAborted: true })).toEqual(
        resolveRunOutcome(QUIET),
      );
    });
  });

  describe("priority order", () => {
    it("manual abort beats everything", () => {
      expect(resolveRunOutcome(EVERYTHING).stopReason).toBe("user");
      expect(resolveRunOutcome(EVERYTHING).status).toBe("cancelled");
    });

    it("provider error beats every stop condition", () => {
      const outcome = resolveRunOutcome({
        ...EVERYTHING,
        manuallyAborted: false,
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.stopReason).toBe("provider_error");
    });

    it("doom loop beats budget, time limit and context limit", () => {
      const outcome = resolveRunOutcome({
        ...EVERYTHING,
        manuallyAborted: false,
        terminalProviderError: false,
      });
      expect(outcome.stopReason).toBe("doom_loop");
    });

    it("budget beats time limit and context limit", () => {
      const outcome = resolveRunOutcome({
        ...EVERYTHING,
        manuallyAborted: false,
        terminalProviderError: false,
        stoppedDueToDoomLoop: false,
      });
      expect(outcome.stopReason).toBe("budget");
    });

    it("time limit beats context limit", () => {
      const outcome = resolveRunOutcome({
        ...EVERYTHING,
        manuallyAborted: false,
        terminalProviderError: false,
        stoppedDueToDoomLoop: false,
        stoppedDueToBudgetExhaustion: false,
      });
      expect(outcome.stopReason).toBe("time_limit");
    });

    it("context limit is last before a clean finish", () => {
      const outcome = resolveRunOutcome({
        ...EVERYTHING,
        manuallyAborted: false,
        terminalProviderError: false,
        stoppedDueToDoomLoop: false,
        stoppedDueToBudgetExhaustion: false,
        stoppedDueToElapsedTimeout: false,
      });
      expect(outcome.stopReason).toBe("context_limit");
    });
  });

  it("every stop reason has a sentence ending in a full stop", () => {
    for (const line of Object.values(RUN_STOP_REASON_LINES)) {
      expect(line.endsWith(".")).toBe(true);
    }
  });
});

describe("describeRunOutcome", () => {
  it("names the reconciler when it closed a run the worker never reported", () => {
    expect(
      describeRunOutcome({
        status: "disconnected",
        stop_reason: RECONCILED_STOP_REASON,
      }),
    ).toBe(RUN_RECONCILED_LINE);
  });

  it("a disconnected run that was not reconciled is just Disconnected", () => {
    expect(describeRunOutcome({ status: "disconnected" })).toBe("Disconnected");
  });

  it("cancelled reads as the person's decision", () => {
    expect(describeRunOutcome({ status: "cancelled" })).toBe("Stopped by you.");
    // The stored stop_reason does not override a cancellation.
    expect(
      describeRunOutcome({ status: "cancelled", stop_reason: "budget" }),
    ).toBe("Stopped by you.");
  });

  describe("failed", () => {
    it("shows the recorded error", () => {
      expect(
        describeRunOutcome({
          status: "failed",
          error: "Rate limited by provider",
        }),
      ).toBe("Rate limited by provider");
    });

    it("falls back to Failed. when there is no error text", () => {
      expect(describeRunOutcome({ status: "failed" })).toBe(RUN_FAILED_LINE);
      expect(describeRunOutcome({ status: "failed", error: "   " })).toBe(
        RUN_FAILED_LINE,
      );
    });

    it("truncates a long error to at most 120 characters", () => {
      const error = "x".repeat(300);
      const line = describeRunOutcome({ status: "failed", error });
      expect(line.length).toBeLessThanOrEqual(MAX_ERROR_LINE_LENGTH);
      expect(line.endsWith("…")).toBe(true);
      expect(line.startsWith("x".repeat(50))).toBe(true);
    });

    it("leaves an error of exactly 120 characters untouched", () => {
      const error = "y".repeat(MAX_ERROR_LINE_LENGTH);
      expect(describeRunOutcome({ status: "failed", error })).toBe(error);
    });
  });

  describe("completed_with_warnings", () => {
    it.each([
      ["doom_loop"],
      ["budget"],
      ["time_limit"],
      ["context_limit"],
      ["provider_error"],
      ["user"],
    ] as const)("uses the shared sentence for stop_reason=%s", (stopReason) => {
      expect(
        describeRunOutcome({
          status: "completed_with_warnings",
          stop_reason: stopReason,
        }),
      ).toBe(RUN_STOP_REASON_LINES[stopReason]);
    });

    it("classifies an older row that only carries finish_reason", () => {
      expect(
        describeRunOutcome({
          status: "completed_with_warnings",
          finish_reason: DOOM_LOOP_FINISH_REASON,
        }),
      ).toBe(RUN_STOP_REASON_LINES.doom_loop);
      expect(
        describeRunOutcome({
          status: "completed_with_warnings",
          finish_reason: BUDGET_EXHAUSTION_FINISH_REASON,
        }),
      ).toBe(RUN_STOP_REASON_LINES.budget);
    });

    it("falls back to the status label when no reason is recorded", () => {
      expect(describeRunOutcome({ status: "completed_with_warnings" })).toBe(
        "Completed with warnings",
      );
      expect(
        describeRunOutcome({
          status: "completed_with_warnings",
          stop_reason: "something-new",
        }),
      ).toBe("Completed with warnings");
    });
  });

  it("completed is Finished.", () => {
    expect(describeRunOutcome({ status: "completed" })).toBe(RUN_FINISHED_LINE);
  });

  it.each([
    ["running", "Running"],
    ["queued", "Queued"],
    ["waiting_for_approval", "Waiting for approval"],
    ["degraded", "Degraded"],
    ["draft", "Draft"],
  ])("other statuses fall back to their label (%s)", (status, label) => {
    expect(describeRunOutcome({ status })).toBe(label);
  });

  it("an unknown stored status is reported as Disconnected, not guessed", () => {
    expect(describeRunOutcome({ status: "who-knows" })).toBe("Disconnected");
  });
});
