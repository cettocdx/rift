jest.mock("../_generated/server", () => ({
  internalAction: (config: unknown) => config,
}));
jest.mock("../_generated/api", () => ({
  internal: {
    runs: { reconcileStaleRuns: "reconcile" },
    crons: { runStaleRunsReconcile: "next" },
    opsAlerts: {},
  },
}));
jest.mock("convex/server", () => ({
  cronJobs: () => ({ interval: jest.fn(), daily: jest.fn() }),
}));
import { runStaleRunsReconcile } from "../crons";

const invoke = (
  runStaleRunsReconcile as unknown as {
    handler: (ctx: unknown, args: { cursor?: string }) => Promise<null>;
  }
).handler;

it("continues after an untouched live page instead of repeatedly scanning it", async () => {
  const runMutation = jest
    .fn()
    .mockResolvedValue({
      closedCount: 0,
      isDone: false,
      continueCursor: "page-2",
    });
  const runAfter = jest.fn();
  await invoke({ runMutation, scheduler: { runAfter } }, {});
  expect(runAfter).toHaveBeenCalledWith(0, "next", { cursor: "page-2" });
});

it("passes the cursor and stops at the end even when the last page closed records", async () => {
  const runMutation = jest
    .fn()
    .mockResolvedValue({
      closedCount: 100,
      isDone: true,
      continueCursor: "end",
    });
  const runAfter = jest.fn();
  await invoke({ runMutation, scheduler: { runAfter } }, { cursor: "page-2" });
  expect(runMutation).toHaveBeenCalledWith(
    "reconcile",
    expect.objectContaining({ cursor: "page-2", limit: 100 }),
  );
  expect(runAfter).not.toHaveBeenCalled();
});

it("does not schedule an endless loop on a repeated cursor", async () => {
  const runMutation = jest
    .fn()
    .mockResolvedValue({
      closedCount: 0,
      isDone: false,
      continueCursor: "same",
    });
  const runAfter = jest.fn();
  await expect(
    invoke({ runMutation, scheduler: { runAfter } }, { cursor: "same" }),
  ).rejects.toThrow("did not advance");
  expect(runAfter).not.toHaveBeenCalled();
});
