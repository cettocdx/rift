import { finalizeAgentLongStartup } from "@/lib/api/agent-long-startup";

describe("finalizeAgentLongStartup", () => {
  it("overlaps token creation and active-run persistence", async () => {
    let resolveToken!: (token: string) => void;
    let resolvePersistence!: () => void;
    const createPublicToken = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveToken = resolve;
        }),
    );
    const persistActiveRun = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePersistence = resolve;
        }),
    );

    const startup = finalizeAgentLongStartup({
      createPublicToken,
      persistActiveRun,
      cancelTriggeredRun: jest.fn(),
    });

    await Promise.resolve();
    expect(createPublicToken).toHaveBeenCalledTimes(1);
    expect(persistActiveRun).toHaveBeenCalledTimes(1);

    resolveToken("public-token");
    resolvePersistence();
    await expect(startup).resolves.toBe("public-token");
  });

  it("cancels and clears an accepted run when token creation fails", async () => {
    const startupError = new Error("token service unavailable");
    const cancelTriggeredRun = jest.fn().mockResolvedValue(undefined);
    const clearActiveRun = jest.fn().mockResolvedValue(undefined);

    await expect(
      finalizeAgentLongStartup({
        createPublicToken: jest.fn().mockRejectedValue(startupError),
        persistActiveRun: jest.fn().mockResolvedValue(undefined),
        cancelTriggeredRun,
        clearActiveRun,
      }),
    ).rejects.toBe(startupError);

    expect(cancelTriggeredRun).toHaveBeenCalledTimes(1);
    expect(clearActiveRun).toHaveBeenCalledTimes(1);
    expect(cancelTriggeredRun.mock.invocationCallOrder[0]).toBeLessThan(
      clearActiveRun.mock.invocationCallOrder[0],
    );
  });

  it("keeps the recovery mapping when cancellation cannot be confirmed", async () => {
    const startupError = new Error("token service unavailable");
    const cancelError = new Error("cancel timed out");
    const clearActiveRun = jest.fn();
    const onCleanupError = jest.fn();

    await expect(
      finalizeAgentLongStartup({
        createPublicToken: jest.fn().mockRejectedValue(startupError),
        persistActiveRun: jest.fn().mockResolvedValue(undefined),
        cancelTriggeredRun: jest.fn().mockRejectedValue(cancelError),
        clearActiveRun,
        onCleanupError,
      }),
    ).rejects.toBe(startupError);

    expect(clearActiveRun).not.toHaveBeenCalled();
    expect(onCleanupError).toHaveBeenCalledWith("cancel", cancelError);
  });

  // The behaviour this pins is the fix for a real report: "I give the agent a
  // task, leave the page, and it stops." It did not stop -- the mapping write
  // that lets the UI find the run again lived in the abandoned request, and
  // failing it used to CANCEL a run that was already executing and billing.
  it("hands over a run whose mapping write failed instead of killing it", async () => {
    const persistError = new Error("convex unavailable");
    const cancelTriggeredRun = jest.fn().mockResolvedValue(undefined);
    const clearActiveRun = jest.fn().mockResolvedValue(undefined);
    const onCleanupError = jest.fn();

    await expect(
      finalizeAgentLongStartup({
        createPublicToken: jest.fn().mockResolvedValue("public-token"),
        persistActiveRun: jest.fn().mockRejectedValue(persistError),
        cancelTriggeredRun,
        clearActiveRun,
        onCleanupError,
      }),
      // The token is what the client subscribes with, so the turn still works.
    ).resolves.toBe("public-token");

    // The run is the user's work. Nothing touches it.
    expect(cancelTriggeredRun).not.toHaveBeenCalled();
    expect(clearActiveRun).not.toHaveBeenCalled();
    // The failure is still reported — the task's own write is now the thing
    // that has to cover it, and a silent gap here would hide that regression.
    expect(onCleanupError).toHaveBeenCalledWith("persist", persistError);
  });
});
