import {
  RUN_STATUSES,
  RUN_STATUS_FILTERS,
  matchesRunFilter,
  runStatusMeta,
  toRunStatus,
  type RunStatus,
} from "../run-status";

describe("canonical run statuses", () => {
  it("covers every state the spec names", () => {
    // The vocabulary is the contract. A surface that needs a state not in here
    // would otherwise invent its own wording, which is how a stopped run came
    // to read as a failure in one place and a success in another.
    expect([...RUN_STATUSES]).toEqual([
      "draft",
      "queued",
      "starting",
      "running",
      "waiting_for_approval",
      "stopping",
      "cancelled",
      "failed",
      "completed",
      "completed_with_warnings",
      "degraded",
      "disconnected",
    ]);
  });

  it("never presents a cancelled run as a failure", () => {
    // The user asked for this. Blaming the product for obeying is exactly the
    // wording this vocabulary exists to prevent.
    const cancelled = runStatusMeta("cancelled");
    expect(cancelled.tone).not.toBe("danger");
    expect(cancelled.isUserInitiated).toBe(true);
    expect(cancelled.isTerminal).toBe(true);
  });

  it("treats disconnected as unfinished, not as an outcome", () => {
    // The stream is gone; the run may still be executing. Marking it terminal
    // would let the client infer completion from the absence of events, which
    // the event contract forbids.
    expect(runStatusMeta("disconnected").isTerminal).toBe(false);
  });

  it("falls back to disconnected for an unrecognised stored value", () => {
    // Not knowing is a real state. Guessing success or failure is not.
    expect(toRunStatus("something-else")).toBe("disconnected");
    expect(toRunStatus(undefined)).toBe("disconnected");
    expect(toRunStatus("completed")).toBe("completed");
  });

  it("gives every status a label and a tone", () => {
    for (const status of RUN_STATUSES) {
      const meta = runStatusMeta(status);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.tone).toBeTruthy();
    }
  });
});

describe("run filters", () => {
  it("offers the filters the Runs destination requires", () => {
    expect(RUN_STATUS_FILTERS.map((f) => f.id)).toEqual([
      "running",
      "needs_attention",
      "completed",
      "failed",
      "cancelled",
      "scheduled",
    ]);
  });

  it("routes each status to exactly one filter, so none is unreachable", () => {
    // A status no filter matches would be invisible in the destination that
    // exists to list every run.
    for (const status of RUN_STATUSES) {
      const hits = RUN_STATUS_FILTERS.filter((filter) =>
        (filter.matches as readonly RunStatus[]).includes(status),
      );
      expect(hits).toHaveLength(1);
    }
  });

  it("puts a stopped run under Cancelled, never under Failed", () => {
    expect(matchesRunFilter("cancelled", "cancelled")).toBe(true);
    expect(matchesRunFilter("cancelled", "failed")).toBe(false);
  });

  it("surfaces a disconnected run as needing attention", () => {
    expect(matchesRunFilter("disconnected", "needs_attention")).toBe(true);
  });

  it("matches everything under all", () => {
    for (const status of RUN_STATUSES) {
      expect(matchesRunFilter(status, "all")).toBe(true);
    }
  });
});
