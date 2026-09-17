/** @jest-environment node */
// Serial mutation interleavings use the real handlers; hosted Convex's
// transaction isolation remains a separate rollout validation.
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
const election = {
  ...token,
  nextClaimId: "next",
  requestMessageId: "dispatch",
  payloadHash: "a".repeat(64),
  fingerprintVersion: 1,
  replaceActiveRun: true,
};
const previousEnv = {
  key: process.env.CONVEX_SERVICE_ROLE_KEY,
  flag: process.env.RIFT_DURABLE_DISPATCH_ADMISSION,
};
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = owner.serviceKey;
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
});
afterEach(() => {
  for (const [name, value] of [
    ["CONVEX_SERVICE_ROLE_KEY", previousEnv.key],
    ["RIFT_DURABLE_DISPATCH_ADMISSION", previousEnv.flag],
  ]) {
    if (value === undefined) delete process.env[name!];
    else process.env[name!] = value;
  }
});
async function setup() {
  return {
    ...dispatchFixture(),
    stops: (await import("../agentDispatchStops")) as any,
    admission: (await import("../agentDispatchAdmission")) as any,
    receipts: (await import("../agentDispatchRequests")) as any,
    claims: (await import("../agentRunClaims")) as any,
  };
}
it.each(["absent", "elected", "attached"])(
  "confirms Stop at %s and permanently fences that request",
  async (stage) => {
    const { ctx, tables, stops, admission } = await setup();
    if (stage === "absent") {
      tables.chats.length = 0;
      tables.agent_run_claims.length = 0;
    } else await admission.elect.handler(ctx, election);
    if (stage === "attached") await admission.attachClaim.handler(ctx, token);
    const stop = await stops.request.handler(ctx, owner);
    expect(stop).toEqual({ dispatchId: "dispatch", canceled: true });
    expect(await stops.request.handler(ctx, owner)).toEqual(stop); // lost HTTP acknowledgment
    expect(tables.agent_dispatch_stops).toHaveLength(1);
    await expect(admission.elect.handler(ctx, election)).rejects.toThrow(
      "DISPATCH_STOPPED",
    );
    if (stage !== "absent") {
      await expect(admission.attachClaim.handler(ctx, token)).rejects.toThrow();
      await expect(
        admission.markDispatching.handler(ctx, token),
      ).rejects.toThrow();
    }
  },
);
it("keeps granted Trigger permission pending through Stop, lost acceptance response and late receipt", async () => {
  const { ctx, tables, stops, admission, receipts, claims } = await setup();
  await admission.elect.handler(ctx, election);
  await admission.attachClaim.handler(ctx, token);
  await admission.markDispatching.handler(ctx, token);
  expect(await stops.request.handler(ctx, owner)).toEqual({
    dispatchId: "dispatch",
    canceled: false,
    claimId: "next",
  });
  expect(
    await claims.activate.handler(ctx, {
      ...owner,
      claimId: "next",
      runId: "late-run",
    }),
  ).toBe(false);
  await receipts.recordAccepted.handler(ctx, {
    ...owner,
    claimId: "next",
    runId: "late-run",
  });
  expect(await stops.request.handler(ctx, owner)).toEqual({
    dispatchId: "dispatch",
    canceled: false,
    claimId: "next",
    runId: "late-run",
  });
  expect(tables.agent_dispatch_requests[0]).toMatchObject({
    state: "accepted",
    run_id: "late-run",
  });
  await receipts.recordTerminal.handler(ctx, {
    ...owner,
    claimId: "next",
    runId: "late-run",
    terminalStatus: "CANCELED",
  });
  expect(await stops.request.handler(ctx, owner)).toMatchObject({
    canceled: true,
    runId: "late-run",
  });
});
it("never targets a predecessor or a newer dispatch in the same chat", async () => {
  const { ctx, tables, stops, admission, receipts } = await setup();
  Object.assign(tables.agent_run_claims[0], {
    phase: "active",
    run_id: "previous",
  });
  tables.chats[0].active_trigger_run_id = "previous";
  await admission.elect.handler(ctx, election);
  expect(await stops.request.handler(ctx, owner)).toEqual({
    dispatchId: "dispatch",
    canceled: true,
  });
  expect(tables.agent_run_claims[0].cancel_requested_at).toBeUndefined();
  expect(tables.chats[0].active_trigger_run_id).toBe("previous");
  const later = {
    ...election,
    dispatchId: "newer",
    nextClaimId: "newer-claim",
  };
  await admission.elect.handler(ctx, later);
  await admission.attachClaim.handler(ctx, {
    ...later,
    confirmedTerminalRunId: "previous",
  });
  await admission.markDispatching.handler(ctx, later);
  await receipts.recordAccepted.handler(ctx, {
    ...owner,
    dispatchId: "newer",
    claimId: "newer-claim",
    runId: "newer-run",
  });
  const snapshot = JSON.stringify([
    tables.agent_run_claims,
    tables.agent_dispatch_admissions,
    tables.chats,
  ]);
  expect(await stops.request.handler(ctx, owner)).toMatchObject({
    canceled: true,
  });
  expect(
    JSON.stringify([
      tables.agent_run_claims,
      tables.agent_dispatch_admissions,
      tables.chats,
    ]),
  ).toBe(snapshot);
});
it("Stop after activation fences effects on the exact claim while preserving acceptance", async () => {
  const { ctx, tables, stops, admission, receipts, claims } = await setup();
  await admission.elect.handler(ctx, election);
  await admission.attachClaim.handler(ctx, token);
  await admission.markDispatching.handler(ctx, token);
  expect(
    await claims.activate.handler(ctx, {
      ...owner,
      claimId: "next",
      runId: "run",
    }),
  ).toBe(true);
  await receipts.recordAccepted.handler(ctx, {
    ...owner,
    claimId: "next",
    runId: "run",
  });
  expect(await stops.request.handler(ctx, owner)).toMatchObject({
    canceled: false,
    runId: "run",
  });
  expect(tables.agent_run_claims[0].cancel_requested_at).toEqual(
    expect.any(Number),
  );
  expect(
    await claims.isExecutionCurrent.handler(ctx, {
      ...owner,
      claimId: "next",
      runId: "run",
    }),
  ).toBe(false);
});
it.each(["chat", "claim", "gate"])(
  "refuses foreign %s authority before persisting any Stop",
  async (kind) => {
    const { ctx, tables, stops, admission } = await setup();
    if (kind === "gate") await admission.elect.handler(ctx, election);
    const table =
      kind === "chat"
        ? tables.chats
        : kind === "claim"
          ? tables.agent_run_claims
          : tables.agent_dispatch_admissions;
    table[0].user_id = "foreign";
    await expect(stops.request.handler(ctx, owner)).rejects.toThrow(
      "FORBIDDEN",
    );
    expect(tables.agent_dispatch_stops).toHaveLength(0);
  },
);
it("does not let another owner's tombstone fence this owner's request", async () => {
  const { ctx, tables, admission } = await setup();
  tables.agent_dispatch_stops.push({
    _id: "foreign-stop",
    user_id: "foreign",
    chat_id: "chat",
    dispatch_id: "dispatch",
    requested_at: 1,
  });
  expect((await admission.elect.handler(ctx, election)).outcome).toBe(
    "elected",
  );
});
it("retains cancellation and readback with both rollout flags disabled", async () => {
  const { ctx, stops } = await setup();
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "false";
  expect(await stops.request.handler(ctx, owner)).toMatchObject({
    canceled: true,
  });
  expect(await stops.getForBackend.handler(ctx, owner)).toMatchObject({
    canceled: true,
  });
});
it("confirms a granted but never attempted dispatch only from the original service attempt", async () => {
  const { ctx, stops, admission } = await setup();
  await admission.elect.handler(ctx, election);
  await admission.attachClaim.handler(ctx, token);
  await admission.markDispatching.handler(ctx, token);
  await stops.request.handler(ctx, owner);
  expect(
    await stops.recordNotDispatched.handler(ctx, {
      ...token,
      attemptId: "wrong",
      claimId: "next",
    }),
  ).toBe(false);
  expect(await stops.getForBackend.handler(ctx, owner)).toMatchObject({
    canceled: false,
  });
  expect(
    await stops.recordNotDispatched.handler(ctx, { ...token, claimId: "next" }),
  ).toBe(true);
  expect(await stops.request.handler(ctx, owner)).toMatchObject({
    canceled: true,
  });
});
it("never overwrites actual acceptance with no-attempt proof, including unexpected late acceptance", async () => {
  const { ctx, tables, stops, admission, receipts } = await setup();
  await admission.elect.handler(ctx, election);
  await admission.attachClaim.handler(ctx, token);
  await admission.markDispatching.handler(ctx, token);
  await stops.request.handler(ctx, owner);
  await stops.recordNotDispatched.handler(ctx, { ...token, claimId: "next" });
  await receipts.recordAccepted.handler(ctx, {
    ...owner,
    claimId: "next",
    runId: "actual-run",
  });
  expect(
    await stops.recordNotDispatched.handler(ctx, { ...token, claimId: "next" }),
  ).toBe(false);
  expect(await stops.getForBackend.handler(ctx, owner)).toMatchObject({
    canceled: false,
    runId: "actual-run",
  });
  expect(tables.agent_dispatch_requests[0]).toMatchObject({
    state: "accepted",
    run_id: "actual-run",
  });
});
it("cannot grant Trigger permission after the original attempt has proved it exited", async () => {
  const { ctx, stops, admission } = await setup();
  await admission.elect.handler(ctx, election);
  await admission.attachClaim.handler(ctx, token);
  expect(
    await stops.recordNotDispatched.handler(ctx, { ...token, claimId: "next" }),
  ).toBe(true);
  await expect(admission.markDispatching.handler(ctx, token)).rejects.toThrow();
});
it("cancels the old exact accepted run without changing a newer claim or active mapping", async () => {
  const { ctx, tables, stops, admission, receipts } = await setup();
  await admission.elect.handler(ctx, election);
  await admission.attachClaim.handler(ctx, token);
  await admission.markDispatching.handler(ctx, token);
  await receipts.recordAccepted.handler(ctx, {
    ...owner,
    claimId: "next",
    runId: "old-run",
  });
  Object.assign(tables.agent_run_claims[0], {
    claim_id: "new-claim",
    dispatch_id: "new-dispatch",
    run_id: "new-run",
    phase: "active",
    cancel_requested_at: undefined,
  });
  tables.chats[0].active_trigger_run_id = "new-run";
  expect(await stops.request.handler(ctx, owner)).toMatchObject({
    canceled: false,
    runId: "old-run",
    claimId: "next",
  });
  await receipts.recordTerminal.handler(ctx, {
    ...owner,
    claimId: "next",
    runId: "old-run",
    terminalStatus: "CANCELED",
  });
  expect(await stops.request.handler(ctx, owner)).toMatchObject({
    canceled: true,
    runId: "old-run",
  });
  expect(tables.agent_run_claims[0]).toMatchObject({
    claim_id: "new-claim",
    phase: "active",
    run_id: "new-run",
  });
  expect(tables.agent_run_claims[0].cancel_requested_at).toBeUndefined();
  expect(tables.chats[0].active_trigger_run_id).toBe("new-run");
});
