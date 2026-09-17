jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
const {
  prepareSteeringStep,
  beginRun,
  markStep,
  markExecution,
  saveStep,
  finishRun,
  disableRun,
} = jest.requireActual("../agentCheckpoints");
const { enqueueForBackend } = jest.requireActual("../agentRunInputs");
const args = {
  serviceKey: "synthetic-steering-prepare",
  userId: "owner-a",
  chatId: "chat-a",
  claimId: "claim-a",
  runId: "run-a",
  requestMessageId: "original-request",
  requestHash: "a".repeat(64),
};
const initialMessagesJson = JSON.stringify([
  { role: "user", content: "Original request" },
]);
const savedKey = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = args.serviceKey;
});
afterAll(() => {
  if (savedKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = savedKey;
});
function fixture() {
  const tables: Record<string, any[]> = {
    chats: [
      {
        _id: "chat-row",
        id: args.chatId,
        user_id: args.userId,
        active_trigger_run_id: args.runId,
      },
    ],
    agent_run_claims: [
      {
        _id: "claim-row",
        chat_id: args.chatId,
        user_id: args.userId,
        claim_id: args.claimId,
        run_id: args.runId,
        phase: "active",
      },
    ],
    agent_checkpoints: [
      {
        _id: "checkpoint-row",
        chat_id: args.chatId,
        user_id: args.userId,
        claim_id: args.claimId,
        run_id: args.runId,
        request_message_id: args.requestMessageId,
        request_hash: args.requestHash,
        status: "active",
        model: "model",
        execution_tracking: 1,
        steering_enabled: 1,
      },
    ],
    agent_run_inputs: [],
  };
  let nextId = 0;
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
          let direction = "asc";
          const cursor = {
            order: (value: string) => {
              direction = value;
              return cursor;
            },
            take: async (n: number) =>
              tables[table]
                .filter((row) =>
                  Object.entries(filters).every(
                    ([key, value]) => row[key] === value,
                  ),
                )
                .sort(
                  (a, b) =>
                    (direction === "desc" ? -1 : 1) *
                    ((a.sequence ?? 0) - (b.sequence ?? 0)),
                )
                .slice(0, n),
          };
          return cursor;
        },
      })),
      insert: jest.fn(async (table: string, value: object) => {
        const row = { _id: `input-${++nextId}`, ...value };
        tables[table].push(row);
        return row._id;
      }),
      patch: jest.fn(async (id: string, value: object) => {
        const row = Object.values(tables)
          .flat()
          .find((row) => row._id === id);
        if (!row) throw new Error("Missing fixture row");
        Object.assign(row, value);
      }),
    },
  };
  return { ctx, tables };
}

const row = (f: ReturnType<typeof fixture>) => f.tables.agent_checkpoints[0];
const enqueue = (f: ReturnType<typeof fixture>, id = "input-a") =>
  enqueueForBackend.handler(f.ctx, {
    ...args,
    clientRequestId: id,
    payloadHash: "b".repeat(64),
    text: `Correction ${id}`,
  });
const prepare = (
  f: ReturnType<typeof fixture>,
  changes: Record<string, unknown> = {},
) =>
  prepareSteeringStep.handler(f.ctx, {
    ...args,
    stepIndex: 1,
    initialMessagesJson,
    ...changes,
  });
const nextRun = (f: ReturnType<typeof fixture>) => {
  f.tables.chats[0].active_trigger_run_id = "run-b";
  Object.assign(f.tables.agent_run_claims[0], {
    claim_id: "claim-b",
    run_id: "run-b",
  });
  return {
    ...args,
    claimId: "claim-b",
    runId: "run-b",
    model: "model",
    executionTracking: 1,
  };
};
const checkpoint = {
  version: 1,
  stepIndex: 1,
  finishReason: "tool-calls",
  messagesJson: initialMessagesJson,
};
function seedPrepared(f: ReturnType<typeof fixture>) {
  Object.assign(row(f), {
    in_flight_step_index: 1,
    steering_prepared_step: {
      step_index: 1,
      claim_id: args.claimId,
      run_id: args.runId,
      input_ids: [],
      initial_messages_json: initialMessagesJson,
    },
  });
}
function noWrites(f: ReturnType<typeof fixture>) {
  expect(f.ctx.db.patch).not.toHaveBeenCalled();
  expect(f.ctx.db.insert).not.toHaveBeenCalled();
}

it("atomically reserves FIFO receipts and marks the step without changing intake targets", async () => {
  const f = fixture();
  const a = await enqueue(f, "a");
  const b = await enqueue(f, "b");
  const result = await prepare(f);
  expect(result).toEqual({
    stepIndex: 1,
    baseMessagesJson: initialMessagesJson,
    inputs: [
      {
        id: a.id,
        sequence: 1,
        text: "Correction a",
        afterResponseMessageCount: 0,
      },
      {
        id: b.id,
        sequence: 2,
        text: "Correction b",
        afterResponseMessageCount: 0,
      },
    ],
  });
  expect(row(f).in_flight_step_index).toBe(1);
  expect(row(f).steering_prepared_step).toEqual({
    step_index: 1,
    claim_id: args.claimId,
    run_id: args.runId,
    input_ids: [a.id, b.id],
    initial_messages_json: initialMessagesJson,
  });
  for (const input of f.tables.agent_run_inputs)
    expect(input).toMatchObject({
      status: "reserved",
      reserved_step_index: 1,
      after_response_message_count: 0,
      claim_id: args.claimId,
      run_id: args.runId,
    });
});
it.each([false, true])(
  "retry keeps the exact %s populated snapshot and excludes later arrivals",
  async (populated) => {
    const f = fixture();
    if (populated) await enqueue(f, "a");
    const first = await prepare(f);
    await enqueue(f, "later");
    f.ctx.db.patch.mockClear();
    expect(await prepare(f)).toEqual(first);
    expect(f.tables.agent_run_inputs.at(-1).status).toBe("pending");
    expect(f.ctx.db.patch).not.toHaveBeenCalled();
    expect(row(f).steering_prepared_step.input_ids).toHaveLength(
      populated ? 1 : 0,
    );
  },
);
it("first-step base is immutable on retry", async () => {
  const f = fixture();
  await prepare(f);
  f.ctx.db.patch.mockClear();
  await expect(
    prepare(f, {
      initialMessagesJson: JSON.stringify([
        { role: "user", content: "changed" },
      ]),
    }),
  ).rejects.toThrow("prepared base");
  expect(await prepare(f, { initialMessagesJson: undefined })).toMatchObject({
    baseMessagesJson: initialMessagesJson,
  });
  expect(f.ctx.db.patch).not.toHaveBeenCalled();
});
it("uses the completed checkpoint as the next step base without storing a duplicate", async () => {
  const f = fixture();
  row(f).checkpoint = checkpoint;
  const input = await enqueue(f);
  expect(
    await prepare(f, { stepIndex: 2, initialMessagesJson: undefined }),
  ).toMatchObject({
    stepIndex: 2,
    baseMessagesJson: initialMessagesJson,
    inputs: [{ id: input.id, afterResponseMessageCount: 0 }],
  });
  expect(row(f).steering_prepared_step.initial_messages_json).toBeUndefined();
});
it.each([
  [
    "claim lost",
    (f: any) => {
      f.tables.agent_run_claims[0].run_id = "other";
    },
  ],
  [
    "canceled",
    (f: any) => {
      f.tables.chats[0].canceled_at = 0;
    },
  ],
  [
    "canceled",
    (f: any) => {
      f.tables.agent_run_claims[0].cancel_requested_at = 0;
    },
  ],
  [
    "canceled",
    (f: any) => {
      f.tables.chats[0].cancel_skip_save = true;
    },
  ],
  [
    "unavailable",
    (f: any) => {
      row(f).blocked_reason = "checkpoint-too-large";
    },
  ],
  [
    "unavailable",
    (f: any) => {
      row(f).status = "finished";
    },
  ],
  [
    "unavailable",
    (f: any) => {
      row(f).claim_id = "other";
    },
  ],
  [
    "disabled",
    (f: any) => {
      row(f).steering_enabled = undefined;
    },
  ],
  [
    "disabled",
    (f: any) => {
      row(f).execution_tracking = undefined;
    },
  ],
  [
    "step",
    (f: any) => {
      row(f).in_flight_step_index = 1;
    },
  ],
  [
    "step",
    (f: any) => {
      row(f).executing_step_index = 1;
    },
  ],
])("rejects %s state without writes", async (message, change) => {
  const f = fixture();
  change(f);
  await expect(prepare(f)).rejects.toThrow(message);
  noWrites(f);
});
it.each([
  { stepIndex: 0 },
  { stepIndex: 1.5 },
  { stepIndex: 2 },
  { requestHash: "b".repeat(64) },
  { requestMessageId: "other" },
])("rejects invalid step/original identity %j", async (changes) => {
  const f = fixture();
  await expect(prepare(f, changes)).rejects.toThrow();
  noWrites(f);
});
it.each([
  undefined,
  "[]",
  "{",
  JSON.stringify([
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "a", toolName: "edit", input: {} },
      ],
    },
  ]),
  JSON.stringify([{ role: "user", content: "x".repeat(750001) }]),
])(
  "rejects missing/invalid/unclosed/oversize initial base before reserving",
  async (initial) => {
    const f = fixture();
    await enqueue(f);
    f.ctx.db.patch.mockClear();
    f.ctx.db.insert.mockClear();
    await expect(
      prepare(f, { initialMessagesJson: initial }),
    ).rejects.toThrow();
    noWrites(f);
    expect(f.tables.agent_run_inputs[0].status).toBe("pending");
  },
);
it.each(["user_id", "chat_id", "request_message_id", "request_hash"])(
  "isolates unrelated receipt %s",
  async (field) => {
    const f = fixture();
    await enqueue(f);
    f.tables.agent_run_inputs[0][field] = "other";
    expect((await prepare(f)).inputs).toEqual([]);
    expect(f.tables.agent_run_inputs[0].status).toBe("pending");
  },
);
it("reserves pending receipts from the prior physical run after same-original recovery", async () => {
  const f = fixture();
  await enqueue(f);
  const next = nextRun(f);
  expect(
    await beginRun.handler(f.ctx, { ...next, steeringPreparation: 1 }),
  ).toMatchObject({ status: "fresh" });
  // No production API enables this capability yet. Model a future fully capable worker.
  row(f).steering_enabled = 1;
  expect((await prepare(f, next)).inputs).toHaveLength(1);
  expect(f.tables.agent_run_inputs[0]).toMatchObject({
    claim_id: args.claimId,
    run_id: args.runId,
    status: "reserved",
  });
});
it.each(["duplicate", "unsafe", "orphan-reserved", "over-cap"])(
  "rejects malformed %s queue without partial reservations",
  async (kind) => {
    const f = fixture();
    await enqueue(f);
    const input = f.tables.agent_run_inputs[0];
    if (kind === "duplicate")
      f.tables.agent_run_inputs.push({ ...input, _id: "duplicate" });
    if (kind === "unsafe") input.sequence = 1.5;
    if (kind === "orphan-reserved") input.status = "reserved";
    if (kind === "over-cap")
      for (let n = 2; n <= 11; n++)
        f.tables.agent_run_inputs.push({
          ...input,
          _id: `extra-${n}`,
          sequence: n,
        });
    f.ctx.db.patch.mockClear();
    await expect(prepare(f)).rejects.toThrow("receipt");
    expect(f.ctx.db.patch).not.toHaveBeenCalled();
  },
);
it.each(["missing", "status", "sequence", "intake", "extra"])(
  "rejects corrupt prepared %s receipt set without rewriting it",
  async (kind) => {
    const f = fixture();
    await enqueue(f);
    await prepare(f);
    const input = f.tables.agent_run_inputs[0];
    if (kind === "missing") f.tables.agent_run_inputs = [];
    if (kind === "status") input.status = "pending";
    if (kind === "sequence") input.sequence = 0;
    if (kind === "intake") input.run_id = "";
    if (kind === "extra")
      f.tables.agent_run_inputs.push({ ...input, _id: "extra", sequence: 2 });
    f.ctx.db.patch.mockClear();
    await expect(prepare(f)).rejects.toThrow("receipt");
    expect(f.ctx.db.patch).not.toHaveBeenCalled();
  },
);
it("authenticates the backend key and owner before reading inputs", async () => {
  for (const changes of [{ serviceKey: "wrong" }, { userId: "intruder" }]) {
    const f = fixture();
    await expect(prepare(f, changes)).rejects.toThrow();
    noWrites(f);
    expect(
      f.ctx.db.query.mock.calls.some(
        ([table]: [string]) => table === "agent_run_inputs",
      ),
    ).toBe(false);
  }
});
it.each(["mark", "save", "finish", "discard"])(
  "legacy %s cannot bypass even an empty prepared snapshot",
  async (kind) => {
    const f = fixture();
    seedPrepared(f);
    const result =
      kind === "mark"
        ? await markStep.handler(f.ctx, { ...args, stepIndex: 1 })
        : kind === "save"
          ? await saveStep.handler(f.ctx, { ...args, checkpoint })
          : await finishRun.handler(f.ctx, {
              ...args,
              discard: kind === "discard",
            });
    expect(result).toBe(false);
    noWrites(f);
    expect(row(f).steering_prepared_step).toBeDefined();
  },
);
it("legacy mark cannot bypass steering admission before the first snapshot", async () => {
  const f = fixture();
  expect(await markStep.handler(f.ctx, { ...args, stepIndex: 1 })).toBe(false);
  noWrites(f);
});
it.each([false, true])(
  "legacy recovery cannot discard a prepared snapshot (new request %s)",
  async (newRequest) => {
    const f = fixture();
    seedPrepared(f);
    const next = nextRun(f);
    const result = await beginRun.handler(f.ctx, {
      ...next,
      ...(newRequest
        ? { requestMessageId: "new", requestHash: "b".repeat(64) }
        : {}),
    });
    expect(result).toMatchObject({
      status: "blocked",
      reason: "steering-prepared",
    });
    noWrites(f);
    expect(row(f).in_flight_step_index).toBe(1);
  },
);
it("explicit preparation-aware recovery preserves the exact first prefix/receipt without reopening admission", async () => {
  const f = fixture();
  const input = await enqueue(f);
  const first = await prepare(f);
  const next = nextRun(f);
  expect(
    await beginRun.handler(f.ctx, { ...next, steeringPreparation: 1 }),
  ).toMatchObject({ status: "fresh", stepIndex: 0 });
  expect(row(f)).toMatchObject({
    claim_id: "claim-b",
    run_id: "run-b",
    in_flight_step_index: 1,
  });
  expect(row(f).steering_enabled).toBeUndefined();
  expect(await prepare(f, { ...next, initialMessagesJson: undefined })).toEqual(
    first,
  );
  expect(f.tables.agent_run_inputs[0]).toMatchObject({
    _id: input.id,
    claim_id: args.claimId,
    run_id: args.runId,
    status: "reserved",
  });
  await expect(prepare(f)).rejects.toThrow("claim lost");
});
it("recovers a later checkpoint reservation without dropping its step marker", async () => {
  const f = fixture();
  row(f).checkpoint = checkpoint;
  const first = await prepare(f, {
    stepIndex: 2,
    initialMessagesJson: undefined,
  });
  const next = nextRun(f);
  expect(
    await beginRun.handler(f.ctx, { ...next, steeringPreparation: 1 }),
  ).toMatchObject({ status: "resume", checkpoint, stepIndex: 1 });
  expect(row(f).in_flight_step_index).toBe(2);
  expect(
    await prepare(f, { ...next, stepIndex: 2, initialMessagesJson: undefined }),
  ).toEqual(first);
});
it("preparation-aware recovery still blocks uncertain execution durably", async () => {
  const f = fixture();
  seedPrepared(f);
  await markExecution.handler(f.ctx, { ...args, stepIndex: 1 });
  const next = nextRun(f);
  expect(
    await beginRun.handler(f.ctx, { ...next, steeringPreparation: 1 }),
  ).toMatchObject({ status: "blocked", reason: "in-flight-step" });
  expect(row(f).steering_prepared_step).toBeDefined();
  expect(
    await beginRun.handler(f.ctx, { ...next, steeringPreparation: 1 }),
  ).toMatchObject({ status: "blocked", reason: "in-flight-step" });
});
it("disabled checkpoint and canceled retries retain the snapshot and cannot be recovered", async () => {
  const f = fixture();
  await prepare(f);
  await disableRun.handler(f.ctx, args);
  const next = nextRun(f);
  expect(
    await beginRun.handler(f.ctx, { ...next, steeringPreparation: 1 }),
  ).toMatchObject({ status: "blocked", reason: "checkpoint-too-large" });
  expect(row(f).steering_prepared_step).toBeDefined();
  f.tables.chats[0].canceled_at = 0;
  await expect(prepare(f, next)).rejects.toThrow("canceled");
  expect(await finishRun.handler(f.ctx, { ...next, discard: true })).toBe(
    false,
  );
  expect(row(f).steering_prepared_step).toBeDefined();
});

it("rejects an empty service credential even if backend configuration is empty", async () => {
  const f = fixture();
  process.env.CONVEX_SERVICE_ROLE_KEY = "";
  await expect(prepare(f, { serviceKey: "" })).rejects.toThrow("Unauthorized");
  expect(f.ctx.db.query).not.toHaveBeenCalled();
  noWrites(f);
});
it.each(["execute", "save"])(
  "legacy %s cannot bypass an enabled but unprepared step",
  async (action) => {
    const f = fixture();
    row(f).in_flight_step_index = 1;
    const result =
      action === "execute"
        ? await markExecution.handler(f.ctx, { ...args, stepIndex: 1 })
        : await saveStep.handler(f.ctx, { ...args, checkpoint });
    expect(result).toBe(false);
    noWrites(f);
  },
);
it.each(["chats", "agent_run_claims", "agent_checkpoints"])(
  "rejects ambiguous %s authority before any reservation",
  async (table) => {
    const f = fixture();
    f.tables[table].push({ ...f.tables[table][0], _id: "duplicate" });
    await expect(prepare(f)).rejects.toThrow("ambiguous");
    noWrites(f);
  },
);
it("cancellation after preparation rejects retry without changing the snapshot", async () => {
  const f = fixture();
  await prepare(f);
  const snapshot = JSON.parse(JSON.stringify(row(f).steering_prepared_step));
  f.tables.agent_run_claims[0].cancel_requested_at = 0;
  f.ctx.db.patch.mockClear();
  await expect(prepare(f)).rejects.toThrow("canceled");
  expect(f.ctx.db.patch).not.toHaveBeenCalled();
  expect(row(f).steering_prepared_step).toEqual(snapshot);
});

it.each(["enabled", "disabled", "recovered"])(
  "legacy operations cannot strand %s pending-only intake",
  async (phase) => {
    const f = fixture();
    await enqueue(f);
    let run: Record<string, unknown> = args;
    if (phase === "disabled") await disableRun.handler(f.ctx, args);
    if (phase === "recovered") {
      run = nextRun(f);
      await beginRun.handler(f.ctx, { ...run, steeringPreparation: 1 });
    }
    f.ctx.db.patch.mockClear();
    expect(await finishRun.handler(f.ctx, { ...run, discard: true })).toBe(
      false,
    );
    expect(await markStep.handler(f.ctx, { ...run, stepIndex: 1 })).toBe(false);
    expect(f.ctx.db.patch).not.toHaveBeenCalled();
    const next = nextRun(f);
    const result = await beginRun.handler(f.ctx, {
      ...next,
      requestMessageId: "replacement",
      requestHash: "c".repeat(64),
      steeringPreparation: 1,
    });
    expect(result.status).toBe("blocked");
    expect(f.ctx.db.patch).not.toHaveBeenCalled();
    expect(row(f).request_message_id).toBe(args.requestMessageId);
    expect(row(f).steering_next_sequence).toBe(2);
    expect(f.tables.agent_run_inputs[0].status).toBe("pending");
  },
);
it.each([{}, { steeringPreparation: 1 }, { executionTracking: 1 }])(
  "legacy pending-only recovery requires both capabilities %j",
  async (capabilities) => {
    const f = fixture();
    await enqueue(f);
    const next = nextRun(f);
    f.ctx.db.patch.mockClear();
    expect(
      await beginRun.handler(f.ctx, {
        ...next,
        executionTracking: undefined,
        ...capabilities,
      }),
    ).toMatchObject({ status: "blocked" });
    expect(f.ctx.db.patch).not.toHaveBeenCalled();
    expect(row(f)).toMatchObject({
      claim_id: args.claimId,
      run_id: args.runId,
      steering_next_sequence: 2,
    });
  },
);
it.each(["mark", "execute", "save", "finish"])(
  "retained sequence alone fences legacy %s after capability reset",
  async (action) => {
    const f = fixture();
    await enqueue(f);
    row(f).steering_enabled = undefined;
    row(f).in_flight_step_index = 1;
    f.ctx.db.patch.mockClear();
    const result =
      action === "mark"
        ? await markStep.handler(f.ctx, { ...args, stepIndex: 1 })
        : action === "execute"
          ? await markExecution.handler(f.ctx, { ...args, stepIndex: 1 })
          : action === "save"
            ? await saveStep.handler(f.ctx, { ...args, checkpoint })
            : await finishRun.handler(f.ctx, args);
    expect(result).toBe(false);
    expect(f.ctx.db.patch).not.toHaveBeenCalled();
  },
);
