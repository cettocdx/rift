/** @jest-environment node */
jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
jest.mock("../_generated/api", () => ({ internal: {} }));
jest.mock("../fileAggregate", () => ({ fileCountAggregate: {} }));
import { dispatchFixture } from "@/test-support/agent-dispatch-fixture";

const owner = {
  serviceKey: "isolated-test-key",
  userId: "owner",
  chatId: "chat",
  dispatchId: "dispatch",
};
const token = { ...owner, attemptId: "attempt" };
const election = {
  ...token,
  nextClaimId: "next",
  requestMessageId: "dispatch",
  payloadHash: "a".repeat(64),
  fingerprintVersion: 1,
  replaceActiveRun: true,
  requiresCleanup: true,
};
const binding = { ...owner, claimId: "next", runId: "run" };
const next = {
  ...election,
  dispatchId: "later",
  requestMessageId: "later",
  attemptId: "later-attempt",
  nextClaimId: "later-claim",
};
const previous = {
  key: process.env.CONVEX_SERVICE_ROLE_KEY,
  flag: process.env.RIFT_DURABLE_DISPATCH_ADMISSION,
};
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = owner.serviceKey;
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
});
afterEach(() => {
  for (const [key, value] of [
    ["CONVEX_SERVICE_ROLE_KEY", previous.key],
    ["RIFT_DURABLE_DISPATCH_ADMISSION", previous.flag],
  ]) {
    if (value === undefined) delete process.env[key!];
    else process.env[key!] = value;
  }
});
async function setup() {
  return {
    ...dispatchFixture(),
    admission: (await import("../agentDispatchAdmission")) as any,
    receipts: (await import("../agentDispatchRequests")) as any,
    claims: (await import("../agentRunClaims")) as any,
    stops: (await import("../agentDispatchStops")) as any,
    http: (await import("../hackHttpExecutions")) as any,
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function started(
  fixture: Fixture,
  requiresCleanup = true,
  effects = true,
) {
  const { ctx, admission, receipts, claims } = fixture;
  await admission.elect.handler(ctx, { ...election, requiresCleanup });
  await admission.attachClaim.handler(ctx, token);
  await admission.markDispatching.handler(ctx, token);
  await receipts.recordAccepted.handler(ctx, binding);
  if (requiresCleanup) {
    await receipts.enterWorker.handler(ctx, {
      ...binding,
      workerEntryId: "entry",
      payloadHash: election.payloadHash,
    });
    if (effects)
      await receipts.markWorkerEffectsStarted.handler(ctx, {
        ...binding,
        workerEntryId: "entry",
        payloadHash: election.payloadHash,
      });
  }
  expect(await claims.activate.handler(ctx, binding)).toBe(true);
}
async function terminal(fixture: Fixture, terminalStatus = "CANCELED") {
  return fixture.receipts.recordTerminal.handler(fixture.ctx, {
    ...binding,
    terminalStatus,
  });
}

it.each(["CANCELED", "CRASHED", "TIMED_OUT", "COMPLETED"])(
  "does not confirm Stop from %s while exact worker cleanup is missing",
  async (status) => {
    const fixture = await setup();
    await started(fixture);
    await terminal(fixture, status);
    expect(await fixture.stops.request.handler(fixture.ctx, owner)).toEqual({
      dispatchId: "dispatch",
      claimId: "next",
      runId: "run",
      canceled: false,
    });
    expect(fixture.tables.agent_run_claims[0].phase).toBe("active");
  },
);

it("refuses worker claim release before its exact cleanup acknowledgment", async () => {
  const fixture = await setup();
  await started(fixture);
  expect(await fixture.claims.release.handler(fixture.ctx, binding)).toBe(
    false,
  );
  expect(fixture.tables.chats[0].active_trigger_run_id).toBe("run");
});

it("refuses replacement election after a terminal provider result without cleanup", async () => {
  const fixture = await setup();
  await started(fixture);
  await terminal(fixture);
  expect(await fixture.admission.elect.handler(fixture.ctx, next)).toEqual({
    outcome: "busy",
  });
});

it("retains a separate fence across old mapping loss, claim replacement attempts, HTTP fallback and rollout rollback", async () => {
  const fixture = await setup();
  await started(fixture);
  await terminal(fixture);
  fixture.tables.agent_run_claims[0].phase = "released";
  delete fixture.tables.chats[0].active_trigger_run_id;
  delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  expect(
    await fixture.claims.reserve.handler(fixture.ctx, {
      ...owner,
      claimId: "other-claim",
    }),
  ).toMatchObject({ acquired: false });
  expect(
    await fixture.http.admit.handler(fixture.ctx, {
      ...owner,
      executionId: "http-fallback",
    }),
  ).toMatchObject({ admitted: false, reason: "busy" });
});

it("accepts only the bound worker cleanup receipt and safely retries lost acknowledgment", async () => {
  const fixture = await setup();
  await started(fixture);
  await terminal(fixture);
  await fixture.stops.request.handler(fixture.ctx, owner);
  for (const key of ["userId", "chatId", "dispatchId", "claimId", "runId"]) {
    await expect(
      fixture.receipts.recordCleanup.handler(fixture.ctx, {
        ...binding,
        [key]: "foreign",
      }),
    ).rejects.toThrow();
  }
  expect(
    await fixture.receipts.recordCleanup.handler(fixture.ctx, {
      ...binding,
      workerEntryId: "entry",
    }),
  ).toBe(true);
  const confirmedAt =
    fixture.tables.agent_dispatch_requests[0].cleanup_confirmed_at;
  expect(
    await fixture.receipts.recordCleanup.handler(fixture.ctx, {
      ...binding,
      workerEntryId: "entry",
    }),
  ).toBe(true);
  expect(fixture.tables.agent_dispatch_requests[0].cleanup_confirmed_at).toBe(
    confirmedAt,
  );
  expect(await fixture.stops.request.handler(fixture.ctx, owner)).toMatchObject(
    { canceled: true },
  );
  expect(
    await fixture.admission.elect.handler(fixture.ctx, next),
  ).toMatchObject({ outcome: "elected" });
});

it("does not mistake cleanup for provider termination or grant the acknowledged worker more effects", async () => {
  const fixture = await setup();
  await started(fixture);
  await fixture.stops.request.handler(fixture.ctx, owner);
  await fixture.receipts.recordCleanup.handler(fixture.ctx, {
    ...binding,
    workerEntryId: "entry",
  });
  expect(await fixture.stops.request.handler(fixture.ctx, owner)).toMatchObject(
    { canceled: false },
  );
  expect(await fixture.claims.activate.handler(fixture.ctx, binding)).toBe(
    false,
  );
});

it("fences effect admission after cleanup even without a user Stop", async () => {
  const fixture = await setup();
  await started(fixture);
  await fixture.receipts.recordCleanup.handler(fixture.ctx, {
    ...binding,
    workerEntryId: "entry",
  });
  expect(
    await fixture.claims.isExecutionCurrent.handler(fixture.ctx, {
      ...binding,
      requireChat: true,
    }),
  ).toBe(false);
});

it("keeps the pending run discoverable during terminal observation and rejects legacy stream registration", async () => {
  const fixture = await setup();
  await started(fixture);
  await terminal(fixture);
  const chats = (await import("../chats")) as any;
  const streams = (await import("../chatStreams")) as any;
  await chats.setActiveTriggerRun.handler(fixture.ctx, {
    ...owner,
    expectedRunId: "run",
    triggerRunId: null,
  });
  expect(fixture.tables.chats[0].active_trigger_run_id).toBe("run");
  await streams.startStream.handler(fixture.ctx, {
    ...owner,
    streamId: "legacy",
  });
  expect(fixture.tables.chats[0].active_stream_id).toBeUndefined();
  await fixture.receipts.recordCleanup.handler(fixture.ctx, {
    ...binding,
    workerEntryId: "entry",
  });
  await chats.setActiveTriggerRun.handler(fixture.ctx, {
    ...owner,
    expectedRunId: "run",
    triggerRunId: null,
  });
  expect(fixture.tables.chats[0].active_trigger_run_id).toBeUndefined();
});

it.each(["absent", "attached", "not-attempted"])(
  "preserves no-producer Stop confirmation at %s",
  async (stage) => {
    const fixture = await setup();
    if (stage !== "absent") {
      await fixture.admission.elect.handler(fixture.ctx, election);
      await fixture.admission.attachClaim.handler(fixture.ctx, token);
    }
    if (stage === "not-attempted") {
      await fixture.admission.markDispatching.handler(fixture.ctx, token);
      await fixture.stops.recordNotDispatched.handler(fixture.ctx, {
        ...token,
        claimId: "next",
      });
    }
    expect(
      await fixture.stops.request.handler(fixture.ctx, owner),
    ).toMatchObject({ canceled: true });
    expect(
      await fixture.admission.elect.handler(fixture.ctx, next),
    ).toMatchObject({ outcome: "elected" });
  },
);

it("legacy late acceptance restores the cleanup fence after a no-attempt proof and cannot be hidden", async () => {
  const fixture = await setup();
  await fixture.admission.elect.handler(fixture.ctx, election);
  await fixture.admission.attachClaim.handler(fixture.ctx, token);
  await fixture.admission.markDispatching.handler(fixture.ctx, token);
  await fixture.stops.recordNotDispatched.handler(fixture.ctx, {
    ...token,
    claimId: "next",
  });
  await fixture.receipts.recordAccepted.handler(fixture.ctx, binding);
  delete fixture.tables.agent_dispatch_requests[0].worker_lifecycle_version;
  await terminal(fixture);
  expect(await fixture.stops.request.handler(fixture.ctx, owner)).toMatchObject(
    { canceled: false },
  );
  expect(
    await fixture.admission.elect.handler(fixture.ctx, next),
  ).toMatchObject({ outcome: "busy" });
});

it("rechecks a late predecessor cleanup fence immediately before new dispatch permission", async () => {
  const fixture = await setup();
  await fixture.admission.elect.handler(fixture.ctx, election);
  await fixture.admission.attachClaim.handler(fixture.ctx, token);
  await fixture.admission.markDispatching.handler(fixture.ctx, token);
  await fixture.stops.recordNotDispatched.handler(fixture.ctx, {
    ...token,
    claimId: "next",
  });
  await fixture.stops.request.handler(fixture.ctx, owner);
  await fixture.admission.elect.handler(fixture.ctx, next);
  await fixture.admission.attachClaim.handler(fixture.ctx, next);
  await fixture.receipts.recordAccepted.handler(fixture.ctx, binding);
  await expect(
    fixture.admission.markDispatching.handler(fixture.ctx, next),
  ).rejects.toThrow("DISPATCH_CLEANUP_REQUIRED");
});

it("rejects cleanup proof before acceptance and refuses missing or legacy requirements", async () => {
  const fixture = await setup();
  await fixture.admission.elect.handler(fixture.ctx, election);
  await fixture.admission.attachClaim.handler(fixture.ctx, token);
  await expect(
    fixture.receipts.recordCleanup.handler(fixture.ctx, {
      ...binding,
      workerEntryId: "entry",
    }),
  ).rejects.toThrow();
  await fixture.admission.markDispatching.handler(fixture.ctx, token);
  await expect(
    fixture.receipts.recordCleanup.handler(fixture.ctx, {
      ...binding,
      workerEntryId: "entry",
    }),
  ).rejects.toThrow();
  await fixture.receipts.recordAccepted.handler(fixture.ctx, binding);
  await expect(
    fixture.receipts.recordCleanup.handler(fixture.ctx, {
      ...binding,
      serviceKey: "wrong",
    }),
  ).rejects.toThrow();
  fixture.tables.agent_dispatch_requests[0].requires_cleanup = undefined;
  await expect(
    fixture.receipts.recordCleanup.handler(fixture.ctx, {
      ...binding,
      workerEntryId: "entry",
    }),
  ).rejects.toThrow();
});

it("preserves legacy Build terminal confirmation and release without a cleanup flag", async () => {
  const fixture = await setup();
  await started(fixture, false);
  await terminal(fixture);
  expect(await fixture.claims.release.handler(fixture.ctx, binding)).toBe(true);
  expect(await fixture.stops.request.handler(fixture.ctx, owner)).toMatchObject(
    { canceled: true },
  );
});

it("does not inherit Hack cleanup requirements when the admission gate is reused for Build", async () => {
  const fixture = await setup();
  await started(fixture);
  await terminal(fixture);
  await fixture.receipts.recordCleanup.handler(fixture.ctx, {
    ...binding,
    workerEntryId: "entry",
  });
  await fixture.claims.release.handler(fixture.ctx, binding);
  await fixture.admission.elect.handler(fixture.ctx, {
    ...next,
    requiresCleanup: false,
  });
  await fixture.admission.attachClaim.handler(fixture.ctx, {
    ...next,
    confirmedTerminalRunId: "run",
  });
  const receipt = await fixture.receipts.getForBackend.handler(
    fixture.ctx,
    next,
  );
  expect(receipt.requiresCleanup).not.toBe(true);
});

it("fences legacy dispatch permission if an older accepted producer reappears during rollback", async () => {
  const fixture = await setup();
  await fixture.admission.elect.handler(fixture.ctx, election);
  await fixture.admission.attachClaim.handler(fixture.ctx, token);
  await fixture.admission.markDispatching.handler(fixture.ctx, token);
  await fixture.stops.recordNotDispatched.handler(fixture.ctx, {
    ...token,
    claimId: "next",
  });
  await fixture.stops.request.handler(fixture.ctx, owner);
  delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  const legacy = { ...next, claimId: "later-claim" };
  expect(
    await fixture.claims.reserve.handler(fixture.ctx, legacy),
  ).toMatchObject({ acquired: true });
  await fixture.receipts.create.handler(fixture.ctx, legacy);
  await fixture.receipts.recordAccepted.handler(fixture.ctx, binding);
  await expect(
    fixture.receipts.markDispatching.handler(fixture.ctx, legacy),
  ).rejects.toThrow("DISPATCH_CLEANUP_REQUIRED");
});

it("requires the exact entered worker and effects permission before activation", async () => {
  const f = await setup();
  await started(f, true, false);
  const args = { ...binding, requireChat: true, workerEntryId: "entry" };
  await expect(
    f.claims.activateForWorker.handler(f.ctx, args),
  ).resolves.toEqual({ activated: false });
  await f.receipts.markWorkerEffectsStarted.handler(f.ctx, {
    ...binding,
    workerEntryId: "entry",
    payloadHash: election.payloadHash,
  });
  await expect(
    f.claims.activateForWorker.handler(f.ctx, {
      ...args,
      workerEntryId: undefined,
    }),
  ).resolves.toEqual({ activated: false });
  await expect(
    f.claims.activateForWorker.handler(f.ctx, {
      ...args,
      workerEntryId: "duplicate",
    }),
  ).resolves.toEqual({ activated: false });
  await expect(
    f.claims.activateForWorker.handler(f.ctx, args),
  ).resolves.toMatchObject({ activated: true });
});

it("rejects a different invocation's strict cleanup acknowledgment", async () => {
  const f = await setup();
  await started(f);
  await expect(
    f.receipts.recordCleanup.handler(f.ctx, {
      ...binding,
      workerEntryId: "duplicate",
    }),
  ).rejects.toThrow();
  expect(f.tables.agent_dispatch_requests[0].cleanup_pending).toBe(true);
});
