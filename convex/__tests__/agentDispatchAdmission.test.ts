/** @jest-environment node */
// Handler tests exercise state transitions with an in-memory DB double.
// They do not prove Convex transaction isolation or concurrent uniqueness.
jest.mock("../_generated/server", () => ({
  mutation: (c: unknown) => c,
  query: (c: unknown) => c,
}));
const SERVICE = "isolated-test-key";
const NOW = 1800000000000;
type Row = Record<string, any>;
function fixture() {
  const tables: Record<string, Row[]> = {
    chats: [
      {
        _id: "chat-row",
        _creationTime: NOW,
        id: "chat",
        user_id: "owner",
        title: "test",
        update_time: NOW,
      },
    ],
    agent_run_claims: [
      {
        _id: "claim-row",
        user_id: "owner",
        chat_id: "chat",
        claim_id: "claim",
        phase: "released",
        lease_until: NOW + 90000,
      },
    ],
    agent_dispatch_requests: [],
    agent_dispatch_admissions: [],
    agent_dispatch_intents: [],
    hack_http_execution_heads: [],
    hack_http_executions: [],
    agent_dispatch_stops: [],
  };
  const db = {
    query: jest.fn((table: string) => ({
      withIndex: (_index: string, predicate: (q: any) => unknown) => {
        const matches: Record<string, unknown> = {};
        const q = {
          eq: (field: string, value: unknown) => {
            matches[field] = value;
            return q;
          },
        };
        predicate(q);
        return {
          take: async (n: number) =>
            tables[table]
              .filter((r) =>
                Object.entries(matches).every(
                  ([key, value]) => r[key] === value,
                ),
              )
              .slice(0, n),
        };
      },
    })),
    patch: jest.fn(async (id: string, patch: Row) => {
      const found = Object.values(tables)
        .flat()
        .find((r) => r._id === id);
      if (!found) throw new Error("missing row");
      Object.assign(found, patch);
    }),
    insert: jest.fn(async (table: string, value: Row) => {
      const next = { _id: `${table}-${tables[table].length}`, ...value };
      tables[table].push(next);
      return next._id;
    }),
  };
  return { ctx: { db }, tables };
}

const base = {
  serviceKey: SERVICE,
  userId: "owner",
  chatId: "chat",
  dispatchId: "dispatch",
  attemptId: "attempt",
  nextClaimId: "next",
  requestMessageId: "message",
  payloadHash: "a".repeat(64),
  fingerprintVersion: 1,
  replaceActiveRun: true,
};
const token = {
  serviceKey: SERVICE,
  userId: "owner",
  chatId: "chat",
  dispatchId: "dispatch",
  attemptId: "attempt",
};
const saved = process.env.CONVEX_SERVICE_ROLE_KEY;
const savedFlag = process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = SERVICE;
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
  if (saved === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = saved;
  if (savedFlag === undefined)
    delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  else process.env.RIFT_DURABLE_DISPATCH_ADMISSION = savedFlag;
});
async function setup() {
  return {
    ...fixture(),
    api: (await import("../agentDispatchAdmission")) as any,
    helper: await import("../lib/agentDispatchAdmission"),
  };
}
it("elects same identity once and serializes a different identity before cancellation", async () => {
  const { ctx, tables, api } = await setup();
  expect((await api.elect.handler(ctx, base)).outcome).toBe("elected");
  expect(
    (
      await api.elect.handler(ctx, {
        ...base,
        attemptId: "other-attempt",
        nextClaimId: "other-claim",
      })
    ).outcome,
  ).toBe("duplicate");
  expect(
    (await api.elect.handler(ctx, { ...base, dispatchId: "other" })).outcome,
  ).toBe("busy");
  expect(tables.agent_dispatch_intents).toHaveLength(1);
  expect(tables.agent_run_claims[0].claim_id).toBe("claim");
  await expect(
    api.authorizeCancellation.handler(ctx, {
      ...token,
      attemptId: "other-attempt",
    }),
  ).rejects.toThrow();
});
it("authorizes only the exact observed old run and refuses a replaced predecessor", async () => {
  const { ctx, tables, api } = await setup();
  Object.assign(tables.agent_run_claims[0], {
    phase: "active",
    run_id: "old-run",
  });
  tables.chats[0].active_trigger_run_id = "old-run";
  await api.elect.handler(ctx, base);
  expect(await api.authorizeCancellation.handler(ctx, token)).toEqual({
    runId: "old-run",
  });
  expect(tables.agent_run_claims[0].cancel_requested_at).toBe(NOW);
  tables.agent_run_claims[0].claim_id = "replacement";
  await expect(
    api.attachClaim.handler(ctx, {
      ...token,
      confirmedTerminalRunId: "old-run",
    }),
  ).rejects.toThrow();
  expect(tables.agent_dispatch_requests).toHaveLength(0);
});
it("attaches receipt and starting claim then grants dispatch only once", async () => {
  const { ctx, tables, api } = await setup();
  await api.elect.handler(ctx, base);
  expect(await api.attachClaim.handler(ctx, token)).toEqual({
    attached: true,
    claimId: "next",
  });
  expect(tables.agent_dispatch_requests[0]).toMatchObject({
    claim_id: "next",
    state: "reserved",
  });
  expect(tables.agent_run_claims[0]).toMatchObject({
    claim_id: "next",
    phase: "starting",
  });
  expect((await api.markDispatching.handler(ctx, token)).transitioned).toBe(
    true,
  );
  jest.setSystemTime(NOW + 99999999);
  expect((await api.markDispatching.handler(ctx, token)).transitioned).toBe(
    false,
  );
});
it.each([false, true])(
  "Stop revokes admission before or after attach (%s)",
  async (attached) => {
    const { ctx, api, helper } = await setup();
    await api.elect.handler(ctx, base);
    if (attached) await api.attachClaim.handler(ctx, token);
    expect(
      await helper.revokeAdmissionGateForStop(ctx as any, {
        userId: "owner",
        chatId: "chat",
      }),
    ).toBe(true);
    await expect(api.attachClaim.handler(ctx, token)).rejects.toThrow();
    await expect(api.markDispatching.handler(ctx, token)).rejects.toThrow();
    expect((await api.elect.handler(ctx, base)).outcome).toBe("duplicate");
  },
);
it("requires exact remote terminal proof before replacing an observed active run", async () => {
  const { ctx, tables, api } = await setup();
  Object.assign(tables.agent_run_claims[0], {
    phase: "active",
    run_id: "old-run",
  });
  await api.elect.handler(ctx, base);
  await expect(api.attachClaim.handler(ctx, token)).rejects.toThrow();
  await expect(
    api.attachClaim.handler(ctx, {
      ...token,
      confirmedTerminalRunId: "different",
    }),
  ).rejects.toThrow();
  expect(
    (
      await api.attachClaim.handler(ctx, {
        ...token,
        confirmedTerminalRunId: "old-run",
      })
    ).attached,
  ).toBe(true);
});
it("keeps terminal requests duplicate after the gate is released and reused", async () => {
  const { ctx, api, tables } = await setup();
  await api.elect.handler(ctx, base);
  await api.attachClaim.handler(ctx, token);
  await api.markDispatching.handler(ctx, token);
  const ledger: any = await import("../agentDispatchRequests");
  await ledger.recordTerminal.handler(ctx, {
    ...token,
    claimId: "next",
    runId: "run",
    terminalStatus: "FAILED",
  });
  expect(tables.agent_dispatch_admissions[0].phase).toBe("released");
  Object.assign(tables.agent_run_claims[0], { phase: "released" });
  expect(
    (
      await api.elect.handler(ctx, {
        ...base,
        dispatchId: "second",
        nextClaimId: "second-claim",
      })
    ).outcome,
  ).toBe("elected");
  expect((await api.elect.handler(ctx, base)).outcome).toBe("duplicate");
});
it("fails closed when disabled, unauthorized, or payload identity conflicts", async () => {
  const { ctx, api } = await setup();
  delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  await expect(api.elect.handler(ctx, base)).rejects.toThrow();
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
  await expect(
    api.elect.handler(ctx, { ...base, userId: "other" }),
  ).rejects.toThrow();
  await api.elect.handler(ctx, base);
  await expect(
    api.elect.handler(ctx, { ...base, payloadHash: "b".repeat(64) }),
  ).rejects.toThrow();
});

it("blocks the original ledger dispatch entry point before and after Stop", async () => {
  const { ctx, api, helper } = await setup();
  await api.elect.handler(ctx, base);
  await api.attachClaim.handler(ctx, token);
  const ledger: any = await import("../agentDispatchRequests");
  const oldToken = { ...token, claimId: "next" };
  await expect(ledger.markDispatching.handler(ctx, oldToken)).rejects.toThrow();
  await helper.revokeAdmissionGateForStop(ctx as any, {
    userId: "owner",
    chatId: "chat",
  });
  await expect(ledger.markDispatching.handler(ctx, oldToken)).rejects.toThrow();
});

it("does not renew or replace a gate because time elapsed", async () => {
  const { ctx, tables, api } = await setup();
  await api.elect.handler(ctx, base);
  jest.setSystemTime(NOW + 999999999);
  expect(
    (await api.elect.handler(ctx, { ...base, dispatchId: "later" })).outcome,
  ).toBe("busy");
  expect(tables.agent_dispatch_admissions[0].attempt_id).toBe("attempt");
});

it("a late acceptance after Stop cannot release a newer request's gate", async () => {
  const { ctx, tables, api, helper } = await setup();
  await api.elect.handler(ctx, base);
  await api.attachClaim.handler(ctx, token);
  await api.markDispatching.handler(ctx, token);
  await helper.revokeAdmissionGateForStop(ctx as any, {
    userId: "owner",
    chatId: "chat",
  });
  tables.agent_run_claims[0].phase = "released";
  await api.elect.handler(ctx, {
    ...base,
    dispatchId: "new",
    attemptId: "new-attempt",
    nextClaimId: "new-claim",
  });
  const ledger: any = await import("../agentDispatchRequests");
  await ledger.recordAccepted.handler(ctx, {
    ...token,
    claimId: "next",
    runId: "late-run",
  });
  expect(tables.agent_dispatch_admissions[0]).toMatchObject({
    dispatch_id: "new",
    phase: "elected",
  });
  expect(tables.agent_dispatch_intents[0].phase).toBe("revoked");
  await expect(api.markDispatching.handler(ctx, token)).rejects.toThrow();
});

it("nonreplacement admission cannot authorize cancellation", async () => {
  const { ctx, api } = await setup();
  await api.elect.handler(ctx, { ...base, replaceActiveRun: false });
  await expect(api.authorizeCancellation.handler(ctx, token)).rejects.toThrow();
});

it("a worker binding the predecessor after election invalidates the attachment", async () => {
  const { ctx, tables, api } = await setup();
  Object.assign(tables.agent_run_claims[0], {
    phase: "starting",
    lease_until: NOW - 1,
  });
  await api.elect.handler(ctx, base);
  Object.assign(tables.agent_run_claims[0], {
    phase: "active",
    run_id: "late-old-run",
  });
  await expect(api.attachClaim.handler(ctx, token)).rejects.toThrow();
  expect(tables.agent_dispatch_requests).toHaveLength(0);
});

it("looks up an owner's intent without returning its dispatch attempt credential", async () => {
  const { ctx, api } = await setup();
  expect(await api.getForBackend.handler(ctx, token)).toBeNull();
  await api.elect.handler(ctx, base);
  expect(await api.getForBackend.handler(ctx, token)).toEqual({
    dispatchId: "dispatch",
    phase: "elected",
    claimId: "next",
    payloadHash: "a".repeat(64),
    fingerprintVersion: 1,
    requestMessageId: "message",
  });
  await expect(
    api.getForBackend.handler(ctx, { ...token, userId: "other" }),
  ).rejects.toThrow();
});

it("returns immutable predecessor on election and allows only untouched election rejection", async () => {
  const { ctx, tables, api } = await setup();
  Object.assign(tables.agent_run_claims[0], { phase: "active", run_id: "old" });
  expect(await api.elect.handler(ctx, base)).toEqual({
    outcome: "elected",
    previousRunId: "old",
  });
  expect(await api.rejectBeforeDispatch.handler(ctx, token)).toEqual({
    rejected: true,
  });
  expect(tables.agent_dispatch_admissions[0].phase).toBe("revoked");
});
it("cannot reject an election after cancellation was authorized", async () => {
  const { ctx, api } = await setup();
  await api.elect.handler(ctx, base);
  await api.authorizeCancellation.handler(ctx, token);
  await expect(api.rejectBeforeDispatch.handler(ctx, token)).rejects.toThrow();
});

it("permanently rejects election after an exact pre-admission Stop, even after a lease would expire", async () => {
  const { ctx, tables, api } = await setup();
  tables.agent_dispatch_stops.push({
    _id: "stop",
    user_id: "owner",
    chat_id: "chat",
    dispatch_id: "dispatch",
    requested_at: NOW,
  });
  jest.setSystemTime(NOW + 365 * 24 * 60 * 60 * 1000);
  await expect(api.elect.handler(ctx, base)).rejects.toThrow(
    "DISPATCH_STOPPED",
  );
  expect(tables.agent_dispatch_intents).toHaveLength(0);
  expect(tables.agent_dispatch_requests).toHaveLength(0);
  expect(tables.agent_run_claims[0].claim_id).toBe("claim");
});
it.each(["authorizeCancellation", "attachClaim", "markDispatching"])(
  "checks the exact Stop tombstone atomically at %s",
  async (transition) => {
    const { ctx, tables, api } = await setup();
    await api.elect.handler(ctx, base);
    if (transition === "markDispatching")
      await api.attachClaim.handler(ctx, token);
    tables.agent_dispatch_stops.push({
      _id: "stop",
      user_id: "owner",
      chat_id: "chat",
      dispatch_id: "dispatch",
      requested_at: NOW,
    });
    await expect(api[transition].handler(ctx, token)).rejects.toThrow(
      "DISPATCH_STOPPED",
    );
    expect(tables.agent_dispatch_requests[0]?.state).not.toBe("dispatching");
  },
);
it("checks the admitted dispatch tombstone again inside worker activation", async () => {
  const { ctx, tables, api } = await setup();
  await api.elect.handler(ctx, base);
  await api.attachClaim.handler(ctx, token);
  await api.markDispatching.handler(ctx, token);
  tables.agent_dispatch_stops.push({
    _id: "stop",
    user_id: "owner",
    chat_id: "chat",
    dispatch_id: "dispatch",
    requested_at: NOW,
  });
  const claims: any = await import("../agentRunClaims");
  expect(
    await claims.activateForWorker.handler(ctx, {
      serviceKey: SERVICE,
      userId: "owner",
      chatId: "chat",
      claimId: "next",
      runId: "run",
      requireChat: true,
    }),
  ).toEqual({ activated: false });
  expect(tables.chats[0].active_trigger_run_id).toBeUndefined();
});

it.each(["recordAccepted", "recordTerminal"])(
  "%s releases only its own admission after rollout is disabled",
  async (method) => {
    const { ctx, tables, api } = await setup();
    await api.elect.handler(ctx, base);
    await api.attachClaim.handler(ctx, token);
    await api.markDispatching.handler(ctx, token);
    process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "false";
    const ledger: any = await import("../agentDispatchRequests");
    const args = {
      ...token,
      claimId: "next",
      runId: "run",
      ...(method === "recordTerminal" ? { terminalStatus: "CANCELED" } : {}),
    };
    await ledger[method].handler(ctx, args);
    await ledger[method].handler(ctx, args);
    expect(tables.agent_dispatch_admissions[0].phase).toBe("released");
    expect(tables.agent_dispatch_intents[0].phase).toBe("released");
    tables.agent_run_claims[0].phase = "released";
    process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
    expect(
      (
        await api.elect.handler(ctx, {
          ...base,
          dispatchId: "successor",
          attemptId: "successor-attempt",
          nextClaimId: "successor-claim",
        })
      ).outcome,
    ).toBe("elected");
    process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "false";
    await ledger[method].handler(ctx, args);
    expect(tables.agent_dispatch_admissions[0]).toMatchObject({
      dispatch_id: "successor",
      phase: "elected",
    });
  },
);

it("receipt settlement during rollback cannot undo Stop revocation", async () => {
  const { ctx, tables, api, helper } = await setup();
  await api.elect.handler(ctx, base);
  await api.attachClaim.handler(ctx, token);
  await api.markDispatching.handler(ctx, token);
  await helper.revokeAdmissionGateForStop(ctx as any, {
    userId: "owner",
    chatId: "chat",
  });
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "false";
  const ledger: any = await import("../agentDispatchRequests");
  await ledger.recordAccepted.handler(ctx, {
    ...token,
    claimId: "next",
    runId: "run",
  });
  expect(tables.agent_dispatch_admissions[0].phase).toBe("revoked");
  expect(tables.agent_dispatch_intents[0].phase).toBe("revoked");
});

it("settles the admission during rollback without inventing remote cleanup", async () => {
  const { ctx, tables, api } = await setup();
  await api.elect.handler(ctx, { ...base, requiresCleanup: true });
  await api.attachClaim.handler(ctx, token);
  await api.markDispatching.handler(ctx, token);
  const ledger: any = await import("../agentDispatchRequests");
  const entry = {
    ...token,
    claimId: "next",
    runId: "run",
    workerEntryId: "entry",
    payloadHash: base.payloadHash,
  };
  await ledger.enterWorker.handler(ctx, entry);
  await ledger.markWorkerEffectsStarted.handler(ctx, entry);
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "false";
  await ledger.recordTerminal.handler(ctx, {
    ...token,
    claimId: "next",
    runId: "run",
    terminalStatus: "CRASHED",
  });
  expect(tables.agent_dispatch_admissions[0].phase).toBe("released");
  expect(tables.agent_dispatch_requests[0].cleanup_pending).toBe(true);
  expect(
    tables.agent_dispatch_requests[0].cleanup_confirmed_at,
  ).toBeUndefined();
  tables.agent_run_claims[0].phase = "released";
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
  await expect(
    api.elect.handler(ctx, { ...base, dispatchId: "successor" }),
  ).resolves.toEqual({ outcome: "busy" });
});
