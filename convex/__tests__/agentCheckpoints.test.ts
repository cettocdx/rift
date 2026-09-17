import { createCheckpointToolBarrier } from "@/lib/agent/checkpoint-tool-barrier";
import { createCompletedStepCheckpoint } from "../../lib/agent/checkpoint";

jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
const {
  beginRun,
  markStep,
  markExecution,
  saveStep,
  finishRun,
  disableRun,
  getForBackend,
} = jest.requireActual("../agentCheckpoints");
const { validateServiceKey } = jest.requireMock("../lib/utils");
const owner = {
  serviceKey: "fixture",
  userId: "owner",
  chatId: "chat",
  claimId: "claim-a",
  runId: "run-a",
};
const beginArgs = {
  ...owner,
  requestMessageId: "request",
  requestHash: "a".repeat(64),
  model: "model",
};
const savedStep = (stepIndex = 1) =>
  createCompletedStepCheckpoint({
    initialMessages: [{ role: "user", content: "edit" }],
    responseMessages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "edit",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "edit",
            output: { type: "text", value: "done" },
          },
        ],
      },
    ],
    stepIndex,
    finishReason: "tool-calls",
  });
function fixture() {
  const tables: Record<string, any[]> = {
    chats: [
      {
        _id: "chat-row",
        id: "chat",
        user_id: "owner",
        active_trigger_run_id: "run-a",
      },
    ],
    agent_run_claims: [
      {
        _id: "claim-row",
        chat_id: "chat",
        user_id: "owner",
        claim_id: "claim-a",
        run_id: "run-a",
        phase: "active",
      },
    ],
    agent_checkpoints: [],
  };
  const ctx: any = {
    db: {
      query: jest.fn((table: string) => ({
        withIndex: (_: string, predicate: any) => {
          const filters: Record<string, unknown> = {};
          const q: any = {
            eq: (key: string, value: unknown) => {
              filters[key] = value;
              return q;
            },
          };
          predicate(q);
          return {
            take: async (n: number) =>
              tables[table]
                .filter((row) =>
                  Object.entries(filters).every(
                    ([key, value]) => row[key] === value,
                  ),
                )
                .slice(0, n),
          };
        },
      })),
      insert: jest.fn(async (table: string, value: unknown) => {
        const row = { _id: `${table}-row`, ...(value as object) };
        tables[table].push(row);
        return row._id;
      }),
      patch: jest.fn(async (id: string, value: unknown) => {
        const row = Object.values(tables)
          .flat()
          .find((row) => row._id === id);
        if (!row) throw new Error("Missing fixture");
        Object.assign(row, value);
      }),
    },
  };
  const replaceRun = () => {
    tables.chats[0].active_trigger_run_id = "run-b";
    Object.assign(tables.agent_run_claims[0], {
      claim_id: "claim-b",
      run_id: "run-b",
    });
    return { ...beginArgs, claimId: "claim-b", runId: "run-b" };
  };
  return { ctx, tables, replaceRun };
}
async function completed(f: ReturnType<typeof fixture>) {
  await beginRun.handler(f.ctx, beginArgs);
  await markStep.handler(f.ctx, { ...owner, stepIndex: 1 });
  await saveStep.handler(f.ctx, { ...owner, checkpoint: savedStep() });
}

beforeEach(() => jest.clearAllMocks());

describe("steering capability belongs to one admitted worker", () => {
  it("blocks replacement while prior steering state needs terminal accounting", async () => {
    const f = fixture();
    await beginRun.handler(f.ctx, beginArgs);
    Object.assign(f.tables.agent_checkpoints[0], {
      steering_enabled: 1,
      steering_next_sequence: 4,
    });
    expect(
      await beginRun.handler(f.ctx, {
        ...f.replaceRun(),
        requestMessageId: "next-request",
        requestHash: "b".repeat(64),
      }),
    ).toMatchObject({ status: "blocked" });
    expect(f.tables.agent_checkpoints[0].steering_enabled).toBe(1);
    expect(f.tables.agent_checkpoints[0].steering_next_sequence).toBe(4);
  });

  it("preserves same-request sequencing but requires renewed worker capability", async () => {
    const f = fixture();
    await completed(f);
    Object.assign(f.tables.agent_checkpoints[0], {
      steering_enabled: 1,
      steering_next_sequence: 4,
    });
    expect(
      await beginRun.handler(f.ctx, {
        ...f.replaceRun(),
        executionTracking: 1,
        steeringPreparation: 1,
      }),
    ).toMatchObject({
      status: "resume",
    });
    expect(f.tables.agent_checkpoints[0].steering_enabled).toBeUndefined();
    expect(f.tables.agent_checkpoints[0].steering_next_sequence).toBe(4);
  });

  it("disables admission without terminally discarding steering state", async () => {
    const f = fixture();
    await beginRun.handler(f.ctx, beginArgs);
    f.tables.agent_checkpoints[0].steering_enabled = 1;
    expect(await finishRun.handler(f.ctx, owner)).toBe(false);
    expect(await disableRun.handler(f.ctx, owner)).toBe(true);
    expect(f.tables.agent_checkpoints[0].steering_enabled).toBeUndefined();
  });
});

describe("owner-fenced completed-step recovery", () => {
  it("starts, marks, and stores only a completed step under the active claim", async () => {
    const f = fixture();
    expect(await beginRun.handler(f.ctx, beginArgs)).toMatchObject({
      status: "fresh",
      checkpoint: null,
      stepIndex: 0,
    });
    expect(await markStep.handler(f.ctx, { ...owner, stepIndex: 1 })).toBe(
      true,
    );
    expect(
      await saveStep.handler(f.ctx, { ...owner, checkpoint: savedStep() }),
    ).toBe(true);
    expect(f.tables.agent_checkpoints[0]).toMatchObject({
      checkpoint: savedStep(),
      in_flight_step_index: undefined,
    });
  });
  it("resumes a completed tool boundary for the same request in a replacement run", async () => {
    const f = fixture();
    await completed(f);
    expect(await beginRun.handler(f.ctx, f.replaceRun())).toMatchObject({
      status: "resume",
      checkpoint: savedStep(),
      stepIndex: 1,
    });
    expect(
      await markStep.handler(f.ctx, {
        ...owner,
        claimId: "claim-b",
        runId: "run-b",
        stepIndex: 2,
      }),
    ).toBe(true);
  });
  it("blocks ambiguous in-flight recovery and keeps it blocked on repeated starts", async () => {
    const f = fixture();
    await completed(f);
    await markStep.handler(f.ctx, { ...owner, stepIndex: 2 });
    const next = f.replaceRun();
    expect(await beginRun.handler(f.ctx, next)).toMatchObject({
      status: "blocked",
      reason: "in-flight-step",
      checkpoint: null,
    });
    expect(await beginRun.handler(f.ctx, next)).toMatchObject({
      status: "blocked",
      reason: "in-flight-step",
    });
  });
  it("also blocks a crashed first step when no snapshot exists", async () => {
    const f = fixture();
    await beginRun.handler(f.ctx, beginArgs);
    await markStep.handler(f.ctx, { ...owner, stepIndex: 1 });
    expect(await beginRun.handler(f.ctx, f.replaceRun())).toMatchObject({
      status: "blocked",
      reason: "in-flight-step",
    });
  });
  it("never restores a different request or edited request content", async () => {
    for (const patch of [
      { requestMessageId: "new-request" },
      { requestHash: "b".repeat(64) },
    ]) {
      const f = fixture();
      await completed(f);
      expect(
        await beginRun.handler(f.ctx, { ...f.replaceRun(), ...patch }),
      ).toMatchObject({ status: "fresh", checkpoint: null, stepIndex: 0 });
    }
  });
  it("fences stale workers, released claims, and mismatched chat mapping", async () => {
    const f = fixture();
    await completed(f);
    f.replaceRun();
    expect(
      await saveStep.handler(f.ctx, { ...owner, checkpoint: savedStep(2) }),
    ).toBe(false);
    expect(await finishRun.handler(f.ctx, owner)).toBe(false);
    expect(await beginRun.handler(f.ctx, beginArgs)).toMatchObject({
      status: "blocked",
      reason: "claim-lost",
    });
    f.tables.agent_run_claims[0].phase = "released";
    expect(
      await markStep.handler(f.ctx, {
        ...owner,
        claimId: "claim-b",
        runId: "run-b",
        stepIndex: 2,
      }),
    ).toBe(false);
  });
  it("requires matching begin-step and monotonic snapshots, permitting exact save retries", async () => {
    const f = fixture();
    await beginRun.handler(f.ctx, beginArgs);
    expect(
      await saveStep.handler(f.ctx, { ...owner, checkpoint: savedStep() }),
    ).toBe(false);
    expect(await markStep.handler(f.ctx, { ...owner, stepIndex: 2 })).toBe(
      false,
    );
    await markStep.handler(f.ctx, { ...owner, stepIndex: 1 });
    await saveStep.handler(f.ctx, { ...owner, checkpoint: savedStep() });
    expect(
      await saveStep.handler(f.ctx, { ...owner, checkpoint: savedStep() }),
    ).toBe(true);
    expect(
      await saveStep.handler(f.ctx, {
        ...owner,
        checkpoint: {
          ...savedStep(),
          messagesJson: savedStep().messagesJson.replace("done", "tampered"),
        },
      }),
    ).toBe(false);
    expect(await markStep.handler(f.ctx, { ...owner, stepIndex: 1 })).toBe(
      false,
    );
  });
  it("cancellation blocks writes and restore; explicit discard clears content", async () => {
    const f = fixture();
    await completed(f);
    f.tables.chats[0].canceled_at = 10;
    f.tables.chats[0].cancel_skip_save = true;
    expect(await markStep.handler(f.ctx, { ...owner, stepIndex: 2 })).toBe(
      false,
    );
    expect(
      await saveStep.handler(f.ctx, { ...owner, checkpoint: savedStep() }),
    ).toBe(false);
    expect(await beginRun.handler(f.ctx, beginArgs)).toMatchObject({
      status: "blocked",
      reason: "canceled",
    });
    expect(await finishRun.handler(f.ctx, { ...owner, discard: true })).toBe(
      true,
    );
    expect(f.tables.agent_checkpoints[0]).toMatchObject({
      status: "finished",
      checkpoint: undefined,
    });
  });
  it("does not disclose other-owner records or mutate before authority validation", async () => {
    const f = fixture();
    f.tables.chats[0].user_id = "other";
    await expect(getForBackend.handler(f.ctx, owner)).rejects.toThrow();
    expect(f.ctx.db.insert).not.toHaveBeenCalled();
    validateServiceKey.mockImplementationOnce(() => {
      throw new Error("denied");
    });
    const next = fixture();
    await expect(beginRun.handler(next.ctx, beginArgs)).rejects.toThrow(
      "denied",
    );
    expect(next.ctx.db.query).not.toHaveBeenCalled();
  });
  it("blocks duplicate terminal requests and rejects corrupt tool history", async () => {
    const f = fixture();
    await completed(f);
    await finishRun.handler(f.ctx, owner);
    const next = f.replaceRun();
    expect(await beginRun.handler(f.ctx, next)).toMatchObject({
      status: "blocked",
      reason: "already-finished",
    });
    expect(
      await beginRun.handler(f.ctx, {
        ...next,
        requestMessageId: "new-request",
      }),
    ).toMatchObject({ status: "fresh", checkpoint: null });
    const bad = {
      ...savedStep(),
      messagesJson: JSON.stringify([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "edit",
              toolCallId: "unresolved",
              input: {},
            },
          ],
        },
      ]),
    };
    await expect(
      saveStep.handler(f.ctx, {
        ...owner,
        claimId: "claim-b",
        runId: "run-b",
        checkpoint: bad,
      }),
    ).rejects.toThrow(/unresolved/i);
  });
  it("blocks a model switch for unchanged active input instead of replaying tools", async () => {
    const f = fixture();
    await completed(f);
    expect(
      await beginRun.handler(f.ctx, {
        ...f.replaceRun(),
        model: "other-model",
      }),
    ).toMatchObject({ status: "blocked", reason: "model-changed" });
  });
  it("records unsupported checkpoint size durably and fences stale disable requests", async () => {
    const f = fixture();
    await completed(f);
    await markStep.handler(f.ctx, { ...owner, stepIndex: 2 });
    expect(await disableRun.handler(f.ctx, owner)).toBe(true);
    expect(await disableRun.handler(f.ctx, owner)).toBe(true);
    const next = f.replaceRun();
    expect(await beginRun.handler(f.ctx, next)).toMatchObject({
      status: "blocked",
      reason: "checkpoint-too-large",
    });
    expect(await disableRun.handler(f.ctx, owner)).toBe(false);
  });
  it("disables recovery durably before a model fallback changes reasoning signatures", async () => {
    const f = fixture();
    await completed(f);
    expect(
      await disableRun.handler(f.ctx, { ...owner, reason: "model-changed" }),
    ).toBe(true);
    expect(
      await disableRun.handler(f.ctx, { ...owner, reason: "model-changed" }),
    ).toBe(true);
    expect(await disableRun.handler(f.ctx, owner)).toBe(false);
    expect(await beginRun.handler(f.ctx, f.replaceRun())).toMatchObject({
      status: "blocked",
      reason: "model-changed",
    });
  });
  it("retains a cancellation tombstone after ordinary chat cleanup clears its flags", async () => {
    const f = fixture();
    await completed(f);
    f.tables.chats[0].canceled_at = 10;
    await finishRun.handler(f.ctx, owner);
    f.tables.chats[0].canceled_at = undefined;
    expect(await beginRun.handler(f.ctx, f.replaceRun())).toMatchObject({
      status: "blocked",
      reason: "canceled",
    });
  });
});

describe("execution-aware recovery", () => {
  async function tracked() {
    const f = fixture();
    await beginRun.handler(f.ctx, { ...beginArgs, executionTracking: 1 });
    await markStep.handler(f.ctx, { ...owner, stepIndex: 1 });
    await markExecution.handler(f.ctx, { ...owner, stepIndex: 1 });
    await saveStep.handler(f.ctx, { ...owner, checkpoint: savedStep() });
    await markStep.handler(f.ctx, { ...owner, stepIndex: 2 });
    return f;
  }
  it("resumes a worker interrupted during a read without replaying a completed edit", async () => {
    const f = await tracked();
    const barrier = createCheckpointToolBarrier({
      isDisabled: () => false,
      assertRead: () => markStep.handler(f.ctx, { ...owner, stepIndex: 2 }),
      markEffect: () =>
        markExecution.handler(f.ctx, { ...owner, stepIndex: 2 }),
    });
    await barrier({
      toolName: "read_file",
      input: { path: "app.ts" },
      toolCallId: "read",
    });
    expect(
      await beginRun.handler(f.ctx, {
        ...f.replaceRun(),
        executionTracking: 1,
      }),
    ).toMatchObject({ status: "resume", checkpoint: savedStep() });
  });
  it("a read following a write cannot erase uncertainty about that write", async () => {
    const f = await tracked();
    const barrier = createCheckpointToolBarrier({
      isDisabled: () => false,
      assertRead: () => markStep.handler(f.ctx, { ...owner, stepIndex: 2 }),
      markEffect: () =>
        markExecution.handler(f.ctx, { ...owner, stepIndex: 2 }),
    });
    await barrier({
      toolName: "write_file",
      input: { path: "app.ts" },
      toolCallId: "write",
    });
    await barrier({
      toolName: "read_file",
      input: { path: "app.ts" },
      toolCallId: "read",
    });
    expect(
      await beginRun.handler(f.ctx, {
        ...f.replaceRun(),
        executionTracking: 1,
      }),
    ).toMatchObject({ status: "blocked", reason: "in-flight-step" });
  });
  it("resumes after interruption while generating arguments without replaying the completed edit", async () => {
    const f = await tracked();
    expect(
      await beginRun.handler(f.ctx, {
        ...f.replaceRun(),
        executionTracking: 1,
      }),
    ).toMatchObject({
      status: "resume",
      checkpoint: savedStep(),
      stepIndex: 1,
    });
    expect(await markExecution.handler(f.ctx, { ...owner, stepIndex: 2 })).toBe(
      false,
    );
  });
  it("keeps a possibly executed action blocked even when a replacement worker retries", async () => {
    const f = await tracked();
    expect(await markExecution.handler(f.ctx, { ...owner, stepIndex: 2 })).toBe(
      true,
    );
    const next = { ...f.replaceRun(), executionTracking: 1 };
    expect(await beginRun.handler(f.ctx, next)).toMatchObject({
      status: "blocked",
      reason: "in-flight-step",
    });
    expect(await beginRun.handler(f.ctx, next)).toMatchObject({
      status: "blocked",
    });
  });
  it("does not allow an untracked replacement to resume an interrupted model step", async () => {
    const f = await tracked();
    expect(await beginRun.handler(f.ctx, f.replaceRun())).toMatchObject({
      status: "blocked",
      reason: "in-flight-step",
    });
  });
  it("rejects tool execution before the model step is recorded", async () => {
    const f = fixture();
    await beginRun.handler(f.ctx, { ...beginArgs, executionTracking: 1 });
    expect(await markExecution.handler(f.ctx, { ...owner, stepIndex: 1 })).toBe(
      false,
    );
  });
  it("rejects a duplicate worker even before its first completed step", async () => {
    const f = fixture();
    const args = { ...beginArgs, executionTracking: 1 };
    await beginRun.handler(f.ctx, args);
    expect(await beginRun.handler(f.ctx, args)).toMatchObject({
      status: "blocked",
      reason: "run-already-started",
    });
  });
});

// The dedicated Hack worker uses the same claim/effect ledger. A transport
// acknowledgement cannot undo a committed marker or invent an observed result.
describe("persistent Hack checkpoint receipt boundaries", () => {
  it("keeps an uncertain terminal dispatch blocked after the marker acknowledgement is lost", async () => {
    const f = fixture();
    f.tables.chats[0].purpose = "security";
    await beginRun.handler(f.ctx, { ...beginArgs, executionTracking: 1 });
    await markStep.handler(f.ctx, { ...owner, stepIndex: 1 });
    const execute = jest.fn();
    const barrier = createCheckpointToolBarrier({
      isDisabled: () => false,
      assertRead: async () => true,
      markEffect: async () => {
        await markExecution.handler(f.ctx, { ...owner, stepIndex: 1 });
        throw new Error("Marker acknowledgement lost");
      },
    });
    await expect(
      (async () => {
        await barrier({
          toolName: "run_terminal_cmd",
          toolCallId: "terminal-1",
          input: { session_id: "previous-worker-session" },
        });
        execute();
      })(),
    ).rejects.toThrow("Marker acknowledgement lost");
    expect(execute).not.toHaveBeenCalled();
    expect(
      await beginRun.handler(f.ctx, {
        ...f.replaceRun(),
        executionTracking: 1,
      }),
    ).toMatchObject({ status: "blocked", reason: "in-flight-step" });
  });

  it("retains a committed closed step after its save acknowledgement is lost", async () => {
    const f = fixture();
    f.tables.chats[0].purpose = "security";
    await beginRun.handler(f.ctx, { ...beginArgs, executionTracking: 1 });
    await markStep.handler(f.ctx, { ...owner, stepIndex: 1 });
    await markExecution.handler(f.ctx, { ...owner, stepIndex: 1 });
    await expect(
      (async () => {
        await saveStep.handler(f.ctx, { ...owner, checkpoint: savedStep() });
        throw new Error("Save acknowledgement lost");
      })(),
    ).rejects.toThrow("Save acknowledgement lost");
    expect(
      await beginRun.handler(f.ctx, {
        ...f.replaceRun(),
        executionTracking: 1,
      }),
    ).toMatchObject({
      status: "resume",
      checkpoint: savedStep(),
      stepIndex: 1,
    });
    expect(await markExecution.handler(f.ctx, { ...owner, stepIndex: 2 })).toBe(
      false,
    );
  });
});
