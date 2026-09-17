/** @jest-environment node */
jest.mock("@/convex/_generated/server", () => ({
  mutation: (value: unknown) => value,
  query: (value: unknown) => value,
  internalMutation: (value: unknown) => value,
}));
import { finishRun as finishCheckpoint } from "@/convex/agentCheckpoints";
import { finishRun as finishRecord, markRunStatus } from "@/convex/runs";
import { createUIMessageStream } from "ai";
import {
  AgentRunCanceledError,
  createWorkerClaimCancellation,
  createPreModelClaimStopFinalizer,
} from "../claim-cancellation";
const binding = {
  userId: "owner",
  chatId: "chat",
  claimId: "claim",
  runId: "run",
};
const authority = { ...binding, serviceKey: "claim-test-authority" };
function fixture(skipSave = false) {
  const completed = {
    version: 1,
    stepIndex: 2,
    finishReason: "tool-calls",
    messagesJson: '[{"role":"assistant","content":"saved"}]',
  };
  const tables: Record<string, any[]> = {
    chats: [
      {
        _id: "chat-row",
        id: "chat",
        user_id: "owner",
        active_trigger_run_id: "run",
        cancel_skip_save: skipSave,
      },
    ],
    agent_run_claims: [
      {
        _id: "claim-row",
        user_id: "owner",
        chat_id: "chat",
        claim_id: "claim",
        run_id: "run",
        phase: "active",
        cancel_requested_at: 1,
      },
    ],
    agent_checkpoints: [
      {
        _id: "checkpoint-row",
        user_id: "owner",
        chat_id: "chat",
        claim_id: "claim",
        run_id: "run",
        status: "active",
        checkpoint: completed,
      },
    ],
    runs: [
      {
        _id: "run-row",
        id: "run",
        chat_id: "chat",
        user_id: "owner",
        status: "running",
      },
    ],
  };
  const db = {
    query: (table: string) => ({
      withIndex: (_name: string, fn: (q: any) => unknown) => {
        const eqs: Record<string, unknown> = {};
        const q = {
          eq: (key: string, value: unknown) => {
            eqs[key] = value;
            return q;
          },
        };
        fn(q);
        const rows = () =>
          tables[table].filter((r) =>
            Object.entries(eqs).every(([k, v]) => r[k] === v),
          );
        return {
          take: async (n: number) => rows().slice(0, n),
          first: async () => rows()[0] ?? null,
        };
      },
    }),
    patch: async (id: string, patch: Record<string, unknown>) => {
      const row = Object.values(tables)
        .flat()
        .find((r) => r._id === id);
      Object.assign(row, patch);
    },
  };
  return { ctx: { db }, tables, completed };
}
const previous = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeAll(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = authority.serviceKey;
});
afterAll(() => {
  if (previous === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = previous;
});
function boundFinalizer(
  f: ReturnType<typeof fixture>,
  flush = jest.fn(async () => {}),
) {
  const finalizer = createPreModelClaimStopFinalizer();
  finalizer.trackCheckpoint(() =>
    (finishCheckpoint as any).handler(f.ctx, authority),
  );
  finalizer.trackRunRecord(async () => {
    await flush();
    await (finishRecord as any).handler(f.ctx, {
      serviceKey: authority.serviceKey,
      runId: binding.runId,
      status: "cancelled",
      stopReason: "user",
    });
  });
  return finalizer;
}
async function stoppedBeforeModel(f: ReturnType<typeof fixture>) {
  const stop = createWorkerClaimCancellation();
  const finalizer = boundFinalizer(f);
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      stop.handle(new AgentRunCanceledError(), writer);
    },
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const terminal = await finalizer.finish();
  return { stop, chunks, terminal };
}
it("confirmed pre-model Stop closes the already-opened durable run without inventing usage", async () => {
  const f = fixture();
  const result = await stoppedBeforeModel(f);
  expect(result.chunks).toEqual([{ type: "abort" }]);
  expect(f.tables.runs[0]).toMatchObject({
    status: "cancelled",
    stop_reason: "user",
  });
  expect(f.tables.runs[0].ended_at).toEqual(expect.any(Number));
  expect(f.tables.runs[0].cost_dollars).toBeUndefined();
  expect(f.tables.runs[0].total_tokens).toBeUndefined();
});
it("confirmed pre-model Stop finishes the exact checkpoint and retains completed work", async () => {
  const f = fixture();
  await stoppedBeforeModel(f);
  expect(f.tables.agent_checkpoints[0]).toMatchObject({
    status: "finished",
    blocked_reason: "canceled",
    checkpoint: f.completed,
  });
});
it("skipSave still discards completed checkpoint only through existing owned backend policy", async () => {
  const f = fixture(true);
  await stoppedBeforeModel(f);
  expect(f.tables.agent_checkpoints[0].checkpoint).toBeUndefined();
  expect(f.tables.agent_checkpoints[0].status).toBe("finished");
});
it("replacement checkpoint cannot be finalized; old run record still closes and unknown facts stay unknown", async () => {
  const f = fixture();
  f.tables.agent_run_claims[0].claim_id = "replacement";
  const result = await stoppedBeforeModel(f);
  expect(result.terminal.checkpoint).toBe("unconfirmed");
  expect(f.tables.agent_checkpoints[0].status).toBe("active");
  expect(f.tables.agent_checkpoints[0].checkpoint).toEqual(f.completed);
  expect(f.tables.runs[0].status).toBe("cancelled");
  expect(f.tables.runs[0].cost_dollars).toBeUndefined();
});
it("the finalizer is single flight, flush precedes terminal write, and late phase marks cannot reopen", async () => {
  const f = fixture();
  const flush = jest.fn(async () => {
    expect(f.tables.runs[0].ended_at).toBeUndefined();
  });
  const finalizer = boundFinalizer(f, flush);
  const [a, b] = await Promise.all([finalizer.finish(), finalizer.finish()]);
  expect(a).toEqual(b);
  expect(a).toEqual({ checkpoint: "confirmed", runRecord: "attempted" });
  expect(flush).toHaveBeenCalledTimes(1);
  await (markRunStatus as any).handler(f.ctx, {
    serviceKey: authority.serviceKey,
    runId: "run",
    status: "running",
    phase: "thinking",
  });
  expect(f.tables.runs[0].status).toBe("cancelled");
});
it("observed or unknown accounting facts are never replaced with synthetic zero", async () => {
  const f = fixture();
  Object.assign(f.tables.runs[0], { cost_dollars: 0.45, total_tokens: 123 });
  await stoppedBeforeModel(f);
  expect(f.tables.runs[0]).toMatchObject({
    cost_dollars: 0.45,
    total_tokens: 123,
    status: "cancelled",
  });
});
it("model-started work remains owned by the existing usage-aware onFinish, with no early terminal writes", async () => {
  const f = fixture();
  const finalizer = boundFinalizer(f);
  finalizer.markModelStarted();
  expect(await finalizer.finish()).toMatchObject({ skipped: "model_started" });
  expect(f.tables.runs[0].status).toBe("running");
  expect(f.tables.agent_checkpoints[0].status).toBe("active");
});
it("a failed checkpoint finish cannot skip run finalization or be reported confirmed", async () => {
  const f = fixture();
  const finalizer = boundFinalizer(f);
  finalizer.trackCheckpoint(async () => {
    throw new Error("unavailable");
  });
  expect(await finalizer.finish()).toEqual({
    checkpoint: "unconfirmed",
    runRecord: "attempted",
  });
  expect(f.tables.runs[0].status).toBe("cancelled");
});
it("actual Trigger abort after recorder setup emits abort and finalizes pre-model resources", async () => {
  const f = fixture();
  const finalizer = boundFinalizer(f);
  const stop = createWorkerClaimCancellation();
  const trigger = new AbortController();
  const onError = jest.fn(() => "unexpected");
  const effect = jest.fn();
  trigger.abort();
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      try {
        trigger.signal.throwIfAborted();
        effect();
      } catch (error) {
        if (!stop.handle(error, writer, trigger.signal)) throw error;
      }
    },
    onError,
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  if (stop.stopped) await finalizer.finish();
  expect(chunks).toEqual([{ type: "abort" }]);
  expect(effect).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(f.tables.runs[0].status).toBe("cancelled");
  expect(f.tables.agent_checkpoints[0].status).toBe("finished");
});
it("an unrelated setup error is not relabeled Stop even when Trigger is also aborted", () => {
  const stop = createWorkerClaimCancellation();
  const trigger = new AbortController();
  trigger.abort();
  expect(
    stop.handle(new Error("transport unavailable"), undefined, trigger.signal),
  ).toBe(false);
});
it("finishes checkpoint before the existing exact generation release clears its ownership fence", async () => {
  const { release } = await import("@/convex/agentRunClaims");
  const f = fixture();
  const finalizer = boundFinalizer(f);
  expect((await finalizer.finish()).checkpoint).toBe("confirmed");
  expect(await (release as any).handler(f.ctx, authority)).toBe(true);
  expect(f.tables.agent_run_claims[0].phase).toBe("released");
  expect(f.tables.chats[0].active_trigger_run_id).toBeUndefined();
  expect(f.tables.agent_checkpoints[0]).toMatchObject({
    status: "finished",
    checkpoint: f.completed,
  });
});
it("worker registers terminal operations before risky awaits and finalizes before claim release", () => {
  const fs = require("node:fs"),
    path = require("node:path");
  const source = fs.readFileSync(
    path.join(process.cwd(), "trigger/agent-long.ts"),
    "utf8",
  );
  expect(source.indexOf("preModelStopFinalizer.trackCheckpoint")).toBeLessThan(
    source.indexOf("const checkpointStart ="),
  );
  expect(source.indexOf("preModelStopFinalizer.trackRunRecord")).toBeLessThan(
    source.indexOf('runRecorderPreparation = measureSetup("runRecord"'),
  );
  expect(
    source.indexOf("preModelStopFinalizer.markModelStarted()"),
  ).toBeLessThan(source.indexOf("return createAgentStream(modelName"));
  expect(source.indexOf("await preModelStopFinalizer.finish()")).toBeLessThan(
    source.lastIndexOf("await releaseAgentRunClaim("),
  );
  expect(source).toContain(": claimCancellation.releaseBinding");
  const finishSource = source.slice(
    source.indexOf("preModelStopFinalizer.trackRunRecord"),
    source.indexOf(
      "let observedUsageTracker",
      source.indexOf("preModelStopFinalizer.trackRunRecord"),
    ),
  );
  expect(finishSource).toContain('status: "cancelled"');
  expect(finishSource).toContain("runId: ctx.run.id");
  expect(finishSource).not.toMatch(/costDollars|totalTokens|outputCount/);
});
it("a committed run row with a lost start acknowledgement still closes by the trusted task ID", async () => {
  const f = fixture();
  const finalizer = createPreModelClaimStopFinalizer();
  let recorder: { flush(): Promise<void> } | undefined;
  finalizer.trackRunRecord(async () => {
    await recorder?.flush();
    await (finishRecord as any).handler(f.ctx, {
      serviceKey: authority.serviceKey,
      runId: binding.runId,
      status: "cancelled",
      stopReason: "user",
    });
  });
  // Backend row exists but the best-effort start wrapper returned no recorder.
  recorder = undefined;
  expect((await finalizer.finish()).runRecord).toBe("attempted");
  expect(f.tables.runs[0].status).toBe("cancelled");
  expect(f.tables.runs[0].cost_dollars).toBeUndefined();
});
it("cleanup of the stopped generation leaves an independent run row untouched", async () => {
  const f = fixture();
  const other = {
    _id: "independent-run-row",
    id: "independent-run",
    user_id: "other-owner",
    chat_id: "other-chat",
    status: "running",
  };
  f.tables.runs.push({ ...other });
  await stoppedBeforeModel(f);
  expect(f.tables.runs[1]).toEqual(other);
});
it("a canceled activation re-entry finishes its prior checkpoint using only verified error binding", async () => {
  const f = fixture();
  const stop = createWorkerClaimCancellation();
  stop.handle(new AgentRunCanceledError(binding));
  const finalizer = createPreModelClaimStopFinalizer();
  finalizer.trackCheckpoint(async () => {
    const owned = stop.releaseBinding;
    if (!owned?.runId) return undefined;
    return (finishCheckpoint as any).handler(f.ctx, {
      ...owned,
      serviceKey: authority.serviceKey,
    });
  });
  expect((await finalizer.finish()).checkpoint).toBe("confirmed");
  expect(f.tables.agent_checkpoints[0]).toMatchObject({
    status: "finished",
    checkpoint: f.completed,
  });
});
it("an unbound queued Stop has no checkpoint run authority", async () => {
  const f = fixture();
  const stop = createWorkerClaimCancellation();
  stop.handle(
    new AgentRunCanceledError({
      userId: binding.userId,
      chatId: binding.chatId,
      claimId: binding.claimId,
    }),
  );
  const finish = jest.fn();
  const finalizer = createPreModelClaimStopFinalizer();
  finalizer.trackCheckpoint(async () => {
    const owned = stop.releaseBinding;
    if (!owned?.runId) return undefined;
    return finish(owned);
  });
  expect((await finalizer.finish()).checkpoint).toBe("not_registered");
  expect(finish).not.toHaveBeenCalled();
  expect(f.tables.agent_checkpoints[0].status).toBe("active");
});

it("replacement after capturing exact canceled binding survives old finalizer and release", async () => {
  const { release } = await import("@/convex/agentRunClaims");
  const f = fixture();
  const stop = createWorkerClaimCancellation();
  stop.handle(new AgentRunCanceledError(binding));
  const finalizer = boundFinalizer(f);
  Object.assign(f.tables.agent_run_claims[0], {
    claim_id: "replacement",
    run_id: "replacement-run",
    cancel_requested_at: undefined,
  });
  Object.assign(f.tables.chats[0], {
    active_trigger_run_id: "replacement-run",
  });
  Object.assign(f.tables.agent_checkpoints[0], {
    claim_id: "replacement",
    run_id: "replacement-run",
  });
  const replacement = structuredClone({
    claim: f.tables.agent_run_claims[0],
    chat: f.tables.chats[0],
    checkpoint: f.tables.agent_checkpoints[0],
  });
  expect((await finalizer.finish()).checkpoint).toBe("unconfirmed");
  expect(
    await (release as any).handler(f.ctx, {
      ...stop.releaseBinding,
      serviceKey: authority.serviceKey,
    }),
  ).toBe(false);
  expect({
    claim: f.tables.agent_run_claims[0],
    chat: f.tables.chats[0],
    checkpoint: f.tables.agent_checkpoints[0],
  }).toEqual(replacement);
  expect(f.tables.runs[0].status).toBe("cancelled");
});
it("unrelated failure during actual linked Trigger abort stays an SDK error without Stop finalization", async () => {
  const { linkAgentAbortSignal } = await import("@/lib/agent/linked-abort");
  const f = fixture();
  const finalizer = boundFinalizer(f);
  const stop = createWorkerClaimCancellation();
  const trigger = new AbortController();
  const linked = linkAgentAbortSignal(trigger.signal);
  const failure = new Error("independent database error");
  trigger.abort(new Error("Trigger canceled"));
  expect(linked.controller.signal.reason).toBe(trigger.signal.reason);
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      if (!stop.handle(failure, writer, trigger.signal)) throw failure;
    },
    onError: () => "independent failure",
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  if (stop.stopped) await finalizer.finish();
  linked.dispose();
  expect(chunks).toEqual([{ type: "error", errorText: "independent failure" }]);
  expect(stop.stopped).toBe(false);
  expect(f.tables.runs[0].status).toBe("running");
  expect(f.tables.agent_checkpoints[0].status).toBe("active");
});
it("joins an in-flight audit row before cancellation closes it", async () => {
  const f = fixture();
  const finalizer = createPreModelClaimStopFinalizer();
  let completeStart!: () => void;
  const starting = new Promise<void>((resolve) => {
    completeStart = resolve;
  });
  let closed = false;
  finalizer.trackRunRecord(async () => {
    await starting;
    await (finishRecord as any).handler(f.ctx, {
      serviceKey: authority.serviceKey,
      runId: binding.runId,
      status: "cancelled",
      stopReason: "user",
    });
    closed = true;
  });
  const stopping = finalizer.finish();
  await Promise.resolve();
  expect(closed).toBe(false);
  completeStart();
  expect((await stopping).runRecord).toBe("attempted");
  expect(f.tables.runs[0].status).toBe("cancelled");
});
