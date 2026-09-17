jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
const { enqueueForBackend, getForBackend } =
  jest.requireActual("../agentRunInputs");
const args = {
  serviceKey: "synthetic-steering-service",
  userId: "owner-a",
  chatId: "chat-a",
  claimId: "claim-a",
  runId: "run-a",
  requestMessageId: "original-request",
  requestHash: "a".repeat(64),
  clientRequestId: "input-a",
  payloadHash: "b".repeat(64),
  text: "Keep the footer",
};
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
const enqueue = (
  f: ReturnType<typeof fixture>,
  changes: Partial<typeof args> = {},
) => enqueueForBackend.handler(f.ctx, { ...args, ...changes });
const read = (
  f: ReturnType<typeof fixture>,
  changes: Partial<typeof args> = {},
) =>
  getForBackend.handler(f.ctx, {
    serviceKey: args.serviceKey,
    userId: args.userId,
    chatId: args.chatId,
    clientRequestId: args.clientRequestId,
    ...changes,
  });
const expectNoWrites = (f: ReturnType<typeof fixture>) => {
  expect(f.ctx.db.insert).not.toHaveBeenCalled();
  expect(f.ctx.db.patch).not.toHaveBeenCalled();
};

it("stores an immutable original/run-bound receipt and advances the checkpoint sequence", async () => {
  const f = fixture();
  expect(await enqueue(f)).toMatchObject({
    clientRequestId: "input-a",
    requestMessageId: args.requestMessageId,
    claimId: "claim-a",
    runId: "run-a",
    sequence: 1,
    status: "pending",
    acceptedAt: expect.any(Number),
  });
  expect(f.tables.agent_run_inputs[0]).toMatchObject({
    user_id: args.userId,
    chat_id: args.chatId,
    request_message_id: args.requestMessageId,
    request_hash: args.requestHash,
    claim_id: args.claimId,
    run_id: args.runId,
    client_request_id: args.clientRequestId,
    payload_hash: args.payloadHash,
    text: args.text,
    sequence: 1,
    status: "pending",
  });
  expect(f.tables.agent_run_inputs[0]).not.toHaveProperty("serviceKey");
  expect(f.tables.agent_checkpoints[0].steering_next_sequence).toBe(2);
});

it("returns the same receipt on a retry after the original run finishes", async () => {
  const f = fixture();
  const first = await enqueue(f);
  f.tables.agent_run_claims[0].phase = "released";
  f.tables.agent_checkpoints[0].status = "finished";
  f.tables.agent_checkpoints[0].steering_enabled = undefined;
  f.tables.chats[0].active_trigger_run_id = undefined;
  expect(await enqueue(f)).toEqual(first);
  expect(f.tables.agent_run_inputs).toHaveLength(1);
  expect(f.ctx.db.insert).toHaveBeenCalledTimes(1);
  expect(f.tables.agent_checkpoints[0].steering_next_sequence).toBe(2);
});

it.each([
  { payloadHash: "c".repeat(64) },
  { text: "Altered text" },
  { requestMessageId: "other-request" },
  { requestHash: "d".repeat(64) },
  { claimId: "other-claim" },
  { runId: "other-run" },
])(
  "rejects changed idempotency payload or bound identity: %j",
  async (changes) => {
    const f = fixture();
    await enqueue(f);
    await expect(enqueue(f, changes)).rejects.toThrow(/conflict/i);
    expect(f.tables.agent_run_inputs).toHaveLength(1);
  },
);

it.each(["chats", "agent_run_claims", "agent_checkpoints"])(
  "rejects another owner in %s",
  async (table) => {
    const f = fixture();
    f.tables[table][0].user_id = "owner-b";
    await expect(enqueue(f)).rejects.toThrow(/own|authoriz/i);
    await expect(read(f)).rejects.toThrow(/own|authoriz/i);
    expectNoWrites(f);
  },
);

it.each(["chats", "agent_run_claims", "agent_checkpoints"])(
  "rejects ambiguous %s rows",
  async (table) => {
    const f = fixture();
    f.tables[table].push({ ...f.tables[table][0], _id: "duplicate" });
    await expect(enqueue(f)).rejects.toThrow(/ambiguous/i);
    await expect(read(f)).rejects.toThrow(/ambiguous/i);
    expectNoWrites(f);
  },
);

it.each(["chats", "agent_run_claims", "agent_checkpoints"])(
  "requires the live %s row for new intake",
  async (table) => {
    const f = fixture();
    f.tables[table] = [];
    await expect(enqueue(f)).rejects.toThrow(/active|unavailable/i);
    expectNoWrites(f);
  },
);

it.each([
  ["agent_run_claims", "claim_id", "claim-b"],
  ["agent_run_claims", "run_id", "run-b"],
  ["agent_run_claims", "phase", "released"],
  ["chats", "active_trigger_run_id", "run-b"],
  ["agent_checkpoints", "claim_id", "claim-b"],
  ["agent_checkpoints", "run_id", "run-b"],
  ["agent_checkpoints", "request_message_id", "request-b"],
  ["agent_checkpoints", "request_hash", "e".repeat(64)],
  ["agent_checkpoints", "status", "finished"],
])("rejects a stale target: %s.%s", async (table, field, value) => {
  const f = fixture();
  f.tables[table][0][field] = value;
  await expect(enqueue(f)).rejects.toThrow(/active|unavailable|target/i);
  expectNoWrites(f);
});

it.each([
  ["agent_run_claims", "cancel_requested_at", 0],
  ["chats", "canceled_at", 0],
  ["chats", "cancel_skip_save", true],
])("honors cancellation at %s.%s", async (table, field, value) => {
  const f = fixture();
  f.tables[table as string][0][field as string] = value;
  await expect(enqueue(f)).rejects.toThrow(/cancel/i);
  expectNoWrites(f);
});

it.each([
  ["steering_enabled", undefined],
  ["execution_tracking", undefined],
  ["blocked_reason", "checkpoint-too-large"],
])("keeps unsupported workers disabled: %s", async (field, value) => {
  const f = fixture();
  f.tables.agent_checkpoints[0][field!] = value;
  await expect(enqueue(f)).rejects.toThrow(/support|disabled|unavailable/i);
  expectNoWrites(f);
});

it("uses the real service-key validator before any DB reads", async () => {
  const f = fixture();
  await expect(enqueue(f, { serviceKey: "wrong" })).rejects.toThrow(
    /unauthorized/i,
  );
  await expect(read(f, { serviceKey: "wrong" })).rejects.toThrow(
    /unauthorized/i,
  );
  expect(f.ctx.db.query).not.toHaveBeenCalled();
  expectNoWrites(f);
});

it("rejects absent/empty configured authority", async () => {
  const f = fixture();
  process.env.CONVEX_SERVICE_ROLE_KEY = "";
  await expect(enqueue(f, { serviceKey: "" })).rejects.toThrow(/unauthorized/i);
  expectNoWrites(f);
});

it.each([
  { text: " \n " },
  { text: "🌱".repeat(4097) },
  { payloadHash: "not-a-hash" },
  { requestHash: "not-a-hash" },
  { clientRequestId: " " },
])("rejects malformed or oversized input", async (changes) => {
  const f = fixture();
  await expect(enqueue(f, changes)).rejects.toThrow(/invalid|limit|large/i);
  expectNoWrites(f);
});

it("preserves valid UTF8 text bytes at the exact limit", async () => {
  const f = fixture();
  const text = "🌱".repeat(4096);
  await enqueue(f, { text });
  expect(f.tables.agent_run_inputs[0].text).toBe(text);
});

it("caps pending plus reserved at ten while allowing retry at capacity", async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++)
    await enqueue(f, { clientRequestId: `input-${i}` });
  f.tables.agent_run_inputs[0].status = "reserved";
  await expect(enqueue(f, { clientRequestId: "overflow" })).rejects.toThrow(
    /full|limit/i,
  );
  expect((await enqueue(f, { clientRequestId: "input-0" })).sequence).toBe(1);
  expect(f.tables.agent_checkpoints[0].steering_next_sequence).toBe(11);
  f.tables.agent_run_inputs[0].status = "applied";
  expect((await enqueue(f, { clientRequestId: "after-ack" })).sequence).toBe(
    11,
  );
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, undefined])(
  "rejects inconsistent sequence counters instead of reusing sequence numbers (%s)",
  async (counter) => {
    const f = fixture();
    await enqueue(f);
    f.tables.agent_checkpoints[0].steering_next_sequence = counter;
    await expect(enqueue(f, { clientRequestId: "next" })).rejects.toThrow(
      /sequence|counter/i,
    );
    expect(f.tables.agent_run_inputs).toHaveLength(1);
  },
);

it("rejects duplicate idempotency receipts without picking an arbitrary row", async () => {
  const f = fixture();
  await enqueue(f);
  f.tables.agent_run_inputs.push({
    ...f.tables.agent_run_inputs[0],
    _id: "duplicate",
  });
  await expect(enqueue(f)).rejects.toThrow(/ambiguous/i);
  await expect(read(f)).rejects.toThrow(/ambiguous/i);
});

it("exposes only scoped receipt status, including terminal delivery fields", async () => {
  const f = fixture();
  await enqueue(f);
  Object.assign(f.tables.agent_run_inputs[0], {
    status: "applied",
    reserved_step_index: 2,
    after_response_message_count: 4,
    applied_step_index: 2,
  });
  const receipt = await read(f);
  expect(receipt).toMatchObject({
    sequence: 1,
    status: "applied",
    reservedStepIndex: 2,
    afterResponseMessageCount: 4,
    appliedStepIndex: 2,
  });
  expect(receipt).not.toHaveProperty("text");
  expect(receipt).not.toHaveProperty("payloadHash");
  expect(receipt).not.toHaveProperty("serviceKey");
  await expect(read(f, { userId: "owner-b" })).rejects.toThrow(/own|authoriz/i);
  expect(await read(f, { clientRequestId: "absent" })).toBeNull();
});

it("preserves the original receipt after cancellation or a newer run takes over", async () => {
  const f = fixture();
  const first = await enqueue(f);
  Object.assign(f.tables.agent_run_claims[0], {
    claim_id: "claim-b",
    run_id: "run-b",
    cancel_requested_at: 123,
  });
  Object.assign(f.tables.agent_checkpoints[0], {
    claim_id: "claim-b",
    run_id: "run-b",
    request_message_id: "request-b",
    request_hash: "f".repeat(64),
    status: "active",
  });
  Object.assign(f.tables.chats[0], {
    active_trigger_run_id: "run-b",
    canceled_at: 123,
  });
  expect(await enqueue(f)).toEqual(first);
  expect(await read(f)).toEqual(first);
  await expect(
    enqueue(f, { clientRequestId: "new-stale-target" }),
  ).rejects.toThrow(/active|target/i);
  expect(f.tables.agent_run_inputs).toHaveLength(1);
});

it("does not silently repair a gap or duplicate in the durable sequence", async () => {
  const f = fixture();
  await enqueue(f);
  f.tables.agent_checkpoints[0].steering_next_sequence = 1;
  await expect(enqueue(f, { clientRequestId: "next" })).rejects.toThrow(
    /sequence/i,
  );
  f.tables.agent_checkpoints[0].steering_next_sequence = 99;
  await expect(enqueue(f, { clientRequestId: "next" })).rejects.toThrow(
    /sequence/i,
  );
  f.tables.agent_checkpoints[0].steering_next_sequence = 2;
  f.tables.agent_run_inputs.push({
    ...f.tables.agent_run_inputs[0],
    _id: "duplicate-sequence",
    client_request_id: "another-client",
  });
  await expect(enqueue(f, { clientRequestId: "next" })).rejects.toThrow(
    /sequence/i,
  );
});

it("assigns FIFO sequences to separate device receipts without charging old requests against the pending cap", async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) {
    f.tables.agent_run_inputs.push({
      _id: `old-${i}`,
      user_id: args.userId,
      chat_id: args.chatId,
      request_message_id: "older-original",
      request_hash: "e".repeat(64),
      sequence: i + 1,
      client_request_id: `old-${i}`,
      status: "pending",
    });
  }
  const first = await enqueue(f, { clientRequestId: "device-a" });
  const second = await enqueue(f, { clientRequestId: "device-b" });
  expect([first.sequence, second.sequence]).toEqual([1, 2]);
  expect(f.tables.agent_checkpoints[0].steering_next_sequence).toBe(3);
});

it("does not accept a service key when the backend configuration is absent", async () => {
  const f = fixture();
  delete process.env.CONVEX_SERVICE_ROLE_KEY;
  await expect(enqueue(f)).rejects.toThrow(/unauthorized/i);
  await expect(read(f)).rejects.toThrow(/unauthorized/i);
  expect(f.ctx.db.query).not.toHaveBeenCalled();
});
