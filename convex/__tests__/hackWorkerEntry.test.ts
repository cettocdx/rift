/** @jest-environment node */
jest.mock("../_generated/server", () => ({
  mutation: (c: unknown) => c,
  query: (c: unknown) => c,
}));
import { dispatchFixture } from "@/test-support/agent-dispatch-fixture";
const owner = {
  serviceKey: "isolated-test-key",
  userId: "owner",
  chatId: "chat",
  dispatchId: "dispatch",
};
const token = { ...owner, attemptId: "attempt" };
const entry = {
  ...owner,
  claimId: "next",
  runId: "run",
  workerEntryId: "entry",
  payloadHash: "a".repeat(64),
};
const saved = {
  key: process.env.CONVEX_SERVICE_ROLE_KEY,
  flag: process.env.RIFT_DURABLE_DISPATCH_ADMISSION,
};
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = owner.serviceKey;
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
});
afterEach(() => {
  for (const [key, value] of [
    ["CONVEX_SERVICE_ROLE_KEY", saved.key],
    ["RIFT_DURABLE_DISPATCH_ADMISSION", saved.flag],
  ]) {
    if (value === undefined) delete process.env[key!];
    else process.env[key!] = value;
  }
});
async function setup() {
  const f = dispatchFixture();
  const admission: any = await import("../agentDispatchAdmission");
  const receipts: any = await import("../agentDispatchRequests");
  await admission.elect.handler(f.ctx, {
    ...token,
    nextClaimId: "next",
    requestMessageId: "dispatch",
    payloadHash: entry.payloadHash,
    fingerprintVersion: 1,
    replaceActiveRun: true,
    requiresCleanup: true,
  });
  await admission.attachClaim.handler(f.ctx, token);
  await admission.markDispatching.handler(f.ctx, token);
  return { ...f, admission, receipts };
}
it("acquires one invocation even when route already marked the claim active", async () => {
  const f = await setup();
  Object.assign(f.tables.agent_run_claims[0], {
    phase: "active",
    run_id: "run",
  });
  f.tables.chats[0].active_trigger_run_id = "run";
  await expect(f.receipts.enterWorker.handler(f.ctx, entry)).resolves.toBe(
    true,
  );
  await expect(f.receipts.enterWorker.handler(f.ctx, entry)).resolves.toBe(
    true,
  );
  await expect(
    f.receipts.enterWorker.handler(f.ctx, {
      ...entry,
      workerEntryId: "duplicate",
    }),
  ).rejects.toThrow();
  expect(
    f.tables.agent_dispatch_requests[0].worker_effects_started_at,
  ).toBeUndefined();
});
it("closes pre-effect failure after rollout disablement without touching a successor mapping", async () => {
  const f = await setup();
  await f.receipts.enterWorker.handler(f.ctx, entry);
  Object.assign(f.tables.agent_run_claims[0], {
    phase: "active",
    run_id: "run",
  });
  f.tables.chats[0].active_trigger_run_id = "run";
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "false";
  await expect(
    f.receipts.recordPreExecutionCleanup.handler(f.ctx, entry),
  ).resolves.toBe(true);
  expect(f.tables.agent_dispatch_requests[0].cleanup_pending).toBe(false);
  expect(f.tables.agent_run_claims[0].phase).toBe("released");
  expect(f.tables.chats[0].active_trigger_run_id).toBeUndefined();
  Object.assign(f.tables.agent_run_claims[0], {
    claim_id: "successor",
    phase: "active",
    run_id: "new-run",
  });
  f.tables.chats[0].active_trigger_run_id = "new-run";
  await f.receipts.recordPreExecutionCleanup.handler(f.ctx, entry);
  expect(f.tables.agent_run_claims[0].phase).toBe("active");
  expect(f.tables.chats[0].active_trigger_run_id).toBe("new-run");
  await expect(
    f.receipts.markWorkerEffectsStarted.handler(f.ctx, entry),
  ).rejects.toThrow();
});
it("never accepts no-effects cleanup after effects were permitted", async () => {
  const f = await setup();
  await f.receipts.enterWorker.handler(f.ctx, entry);
  await f.receipts.markWorkerEffectsStarted.handler(f.ctx, entry);
  await expect(
    f.receipts.recordPreExecutionCleanup.handler(f.ctx, entry),
  ).rejects.toThrow();
  expect(f.tables.agent_dispatch_requests[0].cleanup_pending).toBe(true);
});
it.each([
  "workerEntryId",
  "payloadHash",
  "runId",
  "claimId",
  "userId",
  "chatId",
  "dispatchId",
  "serviceKey",
])("rejects wrong %s without clearing the fence", async (key) => {
  const f = await setup();
  await f.receipts.enterWorker.handler(f.ctx, entry);
  await expect(
    f.receipts.recordPreExecutionCleanup.handler(f.ctx, {
      ...entry,
      [key]: "foreign",
    }),
  ).rejects.toThrow();
  expect(f.tables.agent_dispatch_requests[0].cleanup_pending).toBe(true);
});
it("fails closed for a legacy receipt", async () => {
  const f = await setup();
  delete f.tables.agent_dispatch_requests[0].worker_lifecycle_version;
  await expect(f.receipts.enterWorker.handler(f.ctx, entry)).rejects.toThrow();
});
it("Stop prevents effects but still permits no-effects cleanup", async () => {
  const f = await setup();
  await f.receipts.enterWorker.handler(f.ctx, entry);
  f.tables.agent_dispatch_stops.push({
    _id: "stop",
    user_id: "owner",
    chat_id: "chat",
    dispatch_id: "dispatch",
    requested_at: Date.now(),
  });
  await expect(
    f.receipts.markWorkerEffectsStarted.handler(f.ctx, entry),
  ).rejects.toThrow();
  await expect(
    f.receipts.recordPreExecutionCleanup.handler(f.ctx, entry),
  ).resolves.toBe(true);
});

it.each([false, true])(
  "reconciles definitive death before effects (entered: %s)",
  async (entered) => {
    const f = await setup();
    if (entered) await f.receipts.enterWorker.handler(f.ctx, entry);
    Object.assign(f.tables.agent_run_claims[0], {
      phase: "active",
      run_id: "run",
    });
    f.tables.chats[0].active_trigger_run_id = "run";
    await f.receipts.recordTerminal.handler(f.ctx, {
      ...owner,
      claimId: "next",
      runId: "run",
      terminalStatus: "CRASHED",
    });
    expect(f.tables.agent_dispatch_requests[0].cleanup_pending).toBe(false);
    expect(f.tables.agent_run_claims[0].phase).toBe("released");
    expect(f.tables.chats[0].active_trigger_run_id).toBeUndefined();
    await expect(
      f.receipts.enterWorker.handler(f.ctx, entry),
    ).rejects.toThrow();
    await expect(
      f.receipts.markWorkerEffectsStarted.handler(f.ctx, entry),
    ).rejects.toThrow();
  },
);

it("preserves the remote fence if effects permission preceded death", async () => {
  const f = await setup();
  await f.receipts.enterWorker.handler(f.ctx, entry);
  await f.receipts.markWorkerEffectsStarted.handler(f.ctx, entry);
  await f.receipts.recordTerminal.handler(f.ctx, {
    ...owner,
    claimId: "next",
    runId: "run",
    terminalStatus: "CRASHED",
  });
  expect(f.tables.agent_dispatch_requests[0].cleanup_pending).toBe(true);
  expect(
    f.tables.agent_dispatch_requests[0].cleanup_confirmed_at,
  ).toBeUndefined();
});

it("repairs an older terminal no-effects receipt without touching a successor", async () => {
  const f = await setup();
  await f.receipts.enterWorker.handler(f.ctx, entry);
  Object.assign(f.tables.agent_dispatch_requests[0], {
    state: "terminal",
    terminal_status: "CRASHED",
    terminal_at: 123,
  });
  Object.assign(f.tables.agent_run_claims[0], {
    claim_id: "successor",
    phase: "active",
    run_id: "new-run",
  });
  f.tables.chats[0].active_trigger_run_id = "new-run";
  const args = {
    ...owner,
    claimId: "next",
    runId: "run",
    terminalStatus: "CRASHED",
  };
  await f.receipts.recordTerminal.handler(f.ctx, args);
  await f.receipts.recordTerminal.handler(f.ctx, args);
  expect(f.tables.agent_dispatch_requests[0].cleanup_pending).toBe(false);
  expect(f.tables.agent_dispatch_requests[0].terminal_at).toBe(123);
  expect(f.tables.agent_run_claims[0].phase).toBe("active");
  expect(f.tables.chats[0].active_trigger_run_id).toBe("new-run");
});

it("does not infer no effects for a legacy worker receipt", async () => {
  const f = await setup();
  delete f.tables.agent_dispatch_requests[0].worker_lifecycle_version;
  await f.receipts.recordTerminal.handler(f.ctx, {
    ...owner,
    claimId: "next",
    runId: "run",
    terminalStatus: "CRASHED",
  });
  expect(f.tables.agent_dispatch_requests[0].cleanup_pending).toBe(true);
});
