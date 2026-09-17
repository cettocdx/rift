/** @jest-environment node */
// Real mutation handlers with serial interleavings; hosted Convex transaction
// isolation is validated separately before rollout.
jest.mock("../_generated/server", () => ({
  mutation: (c: unknown) => c,
  internalMutation: (c: unknown) => c,
  query: (c: unknown) => c,
}));
jest.mock("../_generated/api", () => ({
  internal: { redisPubsub: { publishCancellation: "publish" } },
}));
jest.mock("../fileAggregate", () => ({ fileCountAggregate: {} }));
import { dispatchFixture } from "@/test-support/agent-dispatch-fixture";
const owner = {
  serviceKey: "http-test-key",
  userId: "owner",
  chatId: "chat",
  executionId: "execution-a",
};
const later = { ...owner, executionId: "execution-b" };
const savedKey = process.env.CONVEX_SERVICE_ROLE_KEY;
const savedFlag = process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = owner.serviceKey;
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = savedKey;
  if (savedFlag === undefined)
    delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  else process.env.RIFT_DURABLE_DISPATCH_ADMISSION = savedFlag;
});
async function setup() {
  const f = dispatchFixture();
  return {
    ...f,
    ctx: { ...f.ctx, scheduler: { runAfter: jest.fn() } },
    api: (await import("../hackHttpExecutions")) as any,
  };
}
it("Stop before chat creation permanently fences later admission and idempotent retries", async () => {
  const { ctx, tables, api } = await setup();
  tables.chats.length = 0;
  tables.agent_run_claims.length = 0;
  const stop = await api.stop.handler(ctx, owner);
  expect(stop).toMatchObject({
    executionId: "execution-a",
    canceled: true,
    stopped: true,
    phase: "stopped",
  });
  expect(await api.stop.handler(ctx, owner)).toEqual(stop);
  expect(await api.admit.handler(ctx, owner)).toMatchObject({
    admitted: false,
    reason: "stopped",
  });
  expect(tables.hack_http_executions).toHaveLength(1);
  expect(tables.hack_http_execution_heads).toHaveLength(0);
  expect(
    await api.markRunning.handler(ctx, {
      ...owner,
      streamId: owner.executionId,
    }),
  ).toBe(false);
});
it("elects one HTTP producer, refuses duplicate work and makes another execution wait for cleanup", async () => {
  const { ctx, api } = await setup();
  expect(await api.admit.handler(ctx, owner)).toMatchObject({
    admitted: true,
    status: { phase: "admitted" },
  });
  expect(await api.admit.handler(ctx, owner)).toMatchObject({
    admitted: false,
    reason: "duplicate",
  });
  expect(await api.admit.handler(ctx, later)).toMatchObject({
    admitted: false,
    reason: "busy",
  });
  expect(await api.stop.handler(ctx, owner)).toMatchObject({ canceled: false });
  expect(await api.admit.handler(ctx, later)).toMatchObject({
    admitted: false,
    reason: "busy",
  });
  expect(await api.finish.handler(ctx, owner)).toBe(true);
  expect(await api.stop.handler(ctx, owner)).toMatchObject({ canceled: true });
  expect(await api.admit.handler(ctx, later)).toMatchObject({ admitted: true });
});
it("sets both authoritative HTTP identities atomically and refuses a mismatched stream", async () => {
  const { ctx, tables, api } = await setup();
  await api.admit.handler(ctx, owner);
  await expect(
    api.markRunning.handler(ctx, { ...owner, streamId: "other" }),
  ).rejects.toThrow();
  expect(tables.chats[0].active_stream_id).toBeUndefined();
  expect(
    await api.markRunning.handler(ctx, {
      ...owner,
      streamId: owner.executionId,
    }),
  ).toBe(true);
  expect(tables.chats[0]).toMatchObject({
    active_stream_id: owner.executionId,
    active_http_execution_id: owner.executionId,
  });
  expect(
    await api.markRunning.handler(ctx, {
      ...owner,
      streamId: owner.executionId,
    }),
  ).toBe(true);
});
it("Stop only changes its record and publishes its exact identity, preserving chat flags, claims and checkpoints", async () => {
  const { ctx, tables, api } = await setup();
  await api.admit.handler(ctx, owner);
  await api.markRunning.handler(ctx, { ...owner, streamId: owner.executionId });
  Object.assign(tables.chats[0], {
    canceled_at: 99,
    cancel_skip_save: true,
    active_trigger_run_id: "unrelated-run",
  });
  Object.assign(tables.agent_run_claims[0], {
    phase: "active",
    run_id: "unrelated-run",
  });
  tables.agent_checkpoints = [
    {
      _id: "checkpoint",
      user_id: "owner",
      chat_id: "chat",
      run_id: "unrelated-run",
      status: "active",
    },
  ];
  const untouched = JSON.stringify([
    tables.chats,
    tables.agent_run_claims,
    tables.agent_checkpoints,
  ]);
  expect(
    await api.stop.handler(ctx, { ...owner, discard: true }),
  ).toMatchObject({ canceled: false, stopped: true, discard: true });
  expect(
    JSON.stringify([
      tables.chats,
      tables.agent_run_claims,
      tables.agent_checkpoints,
    ]),
  ).toBe(untouched);
  expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(0, "publish", {
    chatId: "chat",
    executionId: "execution-a",
    skipSave: true,
  });
});
it("a late Stop or finish cannot overwrite a newer HTTP head/mapping, and discard remains per execution", async () => {
  const { ctx, tables, api } = await setup();
  await api.admit.handler(ctx, owner);
  await api.markRunning.handler(ctx, { ...owner, streamId: owner.executionId });
  await api.stop.handler(ctx, { ...owner, discard: true });
  await api.finish.handler(ctx, owner);
  expect(await api.admit.handler(ctx, later)).toMatchObject({ admitted: true });
  await api.markRunning.handler(ctx, { ...later, streamId: later.executionId });
  const mappings = JSON.stringify([
    tables.chats,
    tables.hack_http_execution_heads,
  ]);
  expect(await api.stop.handler(ctx, owner)).toMatchObject({
    canceled: true,
    discard: true,
  });
  await api.finish.handler(ctx, owner);
  expect(JSON.stringify([tables.chats, tables.hack_http_execution_heads])).toBe(
    mappings,
  );
  expect(await api.getForBackend.handler(ctx, later)).toMatchObject({
    stopped: false,
    discard: false,
  });
  expect(
    await api.markRunning.handler(ctx, {
      ...owner,
      streamId: owner.executionId,
    }),
  ).toBe(false);
});
it.each(["starting", "active", "gate", "legacy"])(
  "refuses HTTP admission while %s owns startup/execution",
  async (kind) => {
    const { ctx, tables, api } = await setup();
    if (kind === "legacy") tables.chats[0].active_stream_id = "legacy-stream";
    else if (kind === "gate")
      tables.agent_dispatch_admissions.push({
        _id: "gate",
        user_id: "owner",
        chat_id: "chat",
        phase: "elected",
      });
    else tables.agent_run_claims[0].phase = kind;
    expect(await api.admit.handler(ctx, owner)).toMatchObject({
      admitted: false,
      reason: "busy",
    });
    expect(tables.hack_http_executions).toHaveLength(0);
  },
);
it("atomically fences durable election and legacy claim reservation while HTTP has not finished", async () => {
  const { ctx, tables, api } = await setup();
  await api.admit.handler(ctx, owner);
  const admission: any = await import("../agentDispatchAdmission");
  const claims: any = await import("../agentRunClaims");
  expect(
    await admission.elect.handler(ctx, {
      ...owner,
      dispatchId: "dispatch",
      attemptId: "attempt",
      nextClaimId: "next",
      requestMessageId: "message",
      payloadHash: "a".repeat(64),
      fingerprintVersion: 1,
      replaceActiveRun: true,
    }),
  ).toEqual({ outcome: "busy" });
  expect(
    await claims.reserve.handler(ctx, {
      serviceKey: owner.serviceKey,
      userId: "owner",
      chatId: "chat",
      claimId: "next",
    }),
  ).toMatchObject({ acquired: false });
  expect(tables.agent_run_claims[0].claim_id).toBe("claim");
  expect(tables.agent_dispatch_intents).toHaveLength(0);
});
it.each(["chat", "claim", "head"])(
  "refuses foreign %s before creating a Stop tombstone",
  async (kind) => {
    const { ctx, tables, api } = await setup();
    if (kind === "head")
      tables.hack_http_execution_heads.push({
        _id: "head",
        user_id: "other",
        chat_id: "chat",
        execution_id: "other",
      });
    else
      (kind === "chat" ? tables.chats : tables.agent_run_claims)[0].user_id =
        "other";
    await expect(api.stop.handler(ctx, owner)).rejects.toThrow("FORBIDDEN");
    expect(tables.hack_http_executions).toHaveLength(0);
  },
);
it("Stop remains available when rollout is off and cannot acknowledge cleanup that never happened", async () => {
  const { ctx, api } = await setup();
  await api.admit.handler(ctx, owner);
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "false";
  expect(await api.stop.handler(ctx, owner)).toMatchObject({ canceled: false });
  expect(await api.getForBackend.handler(ctx, owner)).toMatchObject({
    phase: "admitted",
    stopped: true,
  });
});

it.each([false, true])(
  "rejects old chat-wide Stop before any side effect when HTTP is admitted/running (%s)",
  async (running) => {
    const { ctx, tables, api } = await setup();
    await api.admit.handler(ctx, owner);
    if (running)
      await api.markRunning.handler(ctx, {
        ...owner,
        streamId: owner.executionId,
      });
    const streams: any = await import("../chatStreams");
    const snapshot = JSON.stringify(tables);
    await expect(
      streams.cancelStreamFromClient.handler(
        {
          ...ctx,
          auth: { getUserIdentity: async () => ({ subject: "owner|session" }) },
        },
        { chatId: "chat", skipSave: true },
      ),
    ).rejects.toThrow("EXACT_HTTP_STOP_REQUIRED");
    expect(JSON.stringify(tables)).toBe(snapshot);
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  },
);

it.each(["updateChat", "prepareForNewStream"])(
  "%s keeps exact identity discoverable during finalization until producer cleanup is acknowledged",
  async (name) => {
    const { ctx, tables, api } = await setup();
    const chats: any = await import("../chats");
    const streams: any = await import("../chatStreams");
    await api.admit.handler(ctx, owner);
    await api.markRunning.handler(ctx, {
      ...owner,
      streamId: owner.executionId,
    });
    await (
      name === "updateChat" ? chats.updateChat : streams.prepareForNewStream
    ).handler(ctx, {
      serviceKey: owner.serviceKey,
      chatId: owner.chatId,
      expectedStreamId: owner.executionId,
      ...(name === "updateChat"
        ? { finishReason: "stop", title: "Saved title" }
        : {}),
    });
    const readChat = () =>
      chats.getChatByIdFromClient.handler(
        {
          ...ctx,
          auth: { getUserIdentity: async () => ({ subject: "owner|session" }) },
        },
        { id: owner.chatId },
      );
    expect(await readChat()).toMatchObject({
      active_stream_id: owner.executionId,
      active_http_execution_id: owner.executionId,
    });
    if (name === "updateChat")
      expect(tables.chats[0]).toMatchObject({
        finish_reason: "stop",
        title: "Saved title",
      });
    expect(await api.stop.handler(ctx, owner)).toMatchObject({
      phase: "running",
      canceled: false,
    });
    expect(await api.admit.handler(ctx, later)).toMatchObject({
      admitted: false,
      reason: "busy",
    });
    await api.finish.handler(ctx, owner);
    const finalChat = await readChat();
    expect(finalChat.active_stream_id).toBeUndefined();
    expect(finalChat.active_http_execution_id).toBeUndefined();
    expect(await api.stop.handler(ctx, owner)).toMatchObject({
      phase: "terminal",
      canceled: true,
    });
    expect(await api.admit.handler(ctx, later)).toMatchObject({
      admitted: true,
    });
  },
);
