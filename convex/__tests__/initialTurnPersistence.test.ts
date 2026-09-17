jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn((key: string) => {
    if (key !== "service-test") throw Error("Invalid service key");
  }),
}));
const { persistInitialTurn } = jest.requireActual("../agentRunClaims");
const NOW = 1_000_000;
const claim = (overrides = {}) => ({
  _id: "claim-row",
  user_id: "owner",
  chat_id: "chat",
  claim_id: "claim",
  phase: "starting",
  started_at: NOW,
  lease_until: NOW + 90_000,
  ...overrides,
});
const chat = (overrides = {}) => ({
  _id: "chat-row",
  id: "chat",
  user_id: "owner",
  title: "Original title",
  ...overrides,
});
const message = (overrides = {}) => ({
  _id: "message-row",
  id: "message",
  chat_id: "chat",
  user_id: "owner",
  role: "user",
  parts: [{ type: "text", text: "Original content" }],
  ...overrides,
});
const args = {
  serviceKey: "service-test",
  userId: "owner",
  chatId: "chat",
  claimId: "claim",
  allowCreate: true,
  title: "New title",
  purpose: "app",
  message: { id: "message", parts: [{ type: "text", text: "hello" }] },
};
function fixture(seed: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = {
    chats: [],
    messages: [],
    files: [],
    projects: [],
    agent_run_claims: [claim()],
    ...JSON.parse(JSON.stringify(seed)),
  };
  const db = {
    query: jest.fn((table: string) => ({
      withIndex: (_index: string, filter: (q: any) => void) => {
        let field = "",
          value: unknown;
        filter({
          eq: (key: string, val: unknown) => {
            field = key;
            value = val;
          },
        });
        return {
          take: async (n: number) =>
            tables[table].filter((row) => row[field] === value).slice(0, n),
        };
      },
    })),
    get: jest.fn(
      async (id: string) =>
        Object.values(tables)
          .flat()
          .find((row) => row._id === id) ?? null,
    ),
    insert: jest.fn(async (table: string, value: any) => {
      const _id = `${table}-${tables[table].length}`;
      tables[table].push({ ...value, _id });
      return _id;
    }),
    patch: jest.fn(async (id: string, value: any) => {
      const row = Object.values(tables)
        .flat()
        .find((row) => row._id === id);
      Object.assign(row, value);
    }),
  };
  const execute = async (overrides = {}) => {
    expect(persistInitialTurn).toBeDefined();
    return persistInitialTurn.handler({ db }, { ...args, ...overrides });
  };
  return { db, tables, execute };
}
beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => jest.restoreAllMocks());

it("creates the chat and initial user message under the same current claim", async () => {
  const f = fixture();
  await f.execute();
  expect(f.tables.chats).toEqual([
    expect.objectContaining({
      id: "chat",
      user_id: "owner",
      title: "New title",
      purpose: "app",
    }),
  ]);
  expect(f.tables.messages).toEqual([
    expect.objectContaining({
      id: "message",
      role: "user",
      content: "hello",
      parts: args.message.parts,
    }),
  ]);
  expect(f.tables.agent_run_claims).toEqual([claim()]);
});
it("validates service authority before reading or writing", async () => {
  const f = fixture();
  await expect(f.execute({ serviceKey: "wrong" })).rejects.toThrow(
    "Invalid service key",
  );
  expect(f.db.query).not.toHaveBeenCalled();
  expect(f.db.insert).not.toHaveBeenCalled();
});
it.each([
  ["missing", []],
  ["replaced", [claim({ claim_id: "newer" })]],
  ["released", [claim({ phase: "released" })]],
  ["active", [claim({ phase: "active", run_id: "run" })]],
  ["bound startup", [claim({ run_id: "run" })]],
])(
  "rejects a %s claim before message/file reads or writes",
  async (_name, rows) => {
    const f = fixture({ agent_run_claims: rows as any[] });
    await expect(f.execute()).rejects.toMatchObject({
      data: { code: "AGENT_RUN_LOST" },
    });
    expect(f.db.query).not.toHaveBeenCalledWith("messages");
    expect(f.db.get).not.toHaveBeenCalled();
    expect(f.db.insert).not.toHaveBeenCalled();
    expect(f.db.patch).not.toHaveBeenCalled();
  },
);
it("does not renew or expire a still-current prepared claim by time alone", async () => {
  const staleLease = claim({ lease_until: NOW - 1 });
  const f = fixture({ agent_run_claims: [staleLease] });
  await f.execute();
  expect(f.tables.agent_run_claims).toEqual([staleLease]);
});
it.each([
  { chats: [chat({ user_id: "foreign" })] },
  { agent_run_claims: [claim({ user_id: "foreign" })] },
  { chats: [chat(), chat({ _id: "duplicate" })] },
  { agent_run_claims: [claim(), claim({ _id: "duplicate" })] },
])(
  "rejects foreign or ambiguous authority without writes (%j)",
  async (seed) => {
    const f = fixture(seed);
    await expect(f.execute()).rejects.toThrow();
    expect(f.db.insert).not.toHaveBeenCalled();
    expect(f.db.patch).not.toHaveBeenCalled();
  },
);
it("fences changed legacy run mapping and never resurrects a deleted existing chat", async () => {
  const changed = fixture({
    chats: [chat({ active_trigger_run_id: "replacement" })],
  });
  await expect(changed.execute()).rejects.toMatchObject({
    data: { code: "AGENT_RUN_LOST" },
  });
  expect(changed.db.insert).not.toHaveBeenCalled();
  const deleted = fixture();
  await expect(deleted.execute({ allowCreate: false })).rejects.toMatchObject({
    data: { code: "CHAT_NOT_FOUND" },
  });
  expect(deleted.db.insert).not.toHaveBeenCalled();
});
it("retries do not duplicate rows, overwrite user content or retitle an existing chat", async () => {
  const f = fixture();
  await f.execute();
  await f.execute({
    title: "Changed",
    message: { ...args.message, parts: [{ type: "text", text: "Changed" }] },
  });
  expect(f.tables.chats).toHaveLength(1);
  expect(f.tables.chats[0].title).toBe("New title");
  expect(f.tables.messages).toHaveLength(1);
  expect(f.tables.messages[0].parts).toEqual(args.message.parts);
});
it.each([
  ["released", { phase: "released" }],
  ["replaced", { claim_id: "newer" }],
])(
  "rejects a persisted-message retry after the claim is %s",
  async (_name, update) => {
    const f = fixture();
    await f.execute();
    Object.assign(f.tables.agent_run_claims[0], update);
    f.db.insert.mockClear();
    f.db.patch.mockClear();
    await expect(
      f.execute({ message: { ...args.message, isHidden: true } }),
    ).rejects.toMatchObject({
      data: { code: "AGENT_RUN_LOST" },
    });
    expect(f.tables.chats).toHaveLength(1);
    expect(f.tables.messages).toHaveLength(1);
    expect(f.tables.messages[0].is_hidden).toBeUndefined();
    expect(f.db.insert).not.toHaveBeenCalled();
    expect(f.db.patch).not.toHaveBeenCalled();
  },
);
it.each(
  [
    [message({ user_id: "foreign" })],
    [message({ chat_id: "other" })],
    [message({ role: "assistant" })],
    [message(), message({ _id: "duplicate" })],
  ].map((rows) => [rows]),
)(
  "rejects conflicting message IDs before creating a chat (%j)",
  async (rows) => {
    const f = fixture({ messages: rows });
    await expect(f.execute()).rejects.toThrow();
    expect(f.db.insert).not.toHaveBeenCalled();
    expect(f.db.patch).not.toHaveBeenCalled();
  },
);
it.each([null, { _id: "file", user_id: "foreign" }])(
  "rejects invalid attachments before creating any rows (%j)",
  async (file) => {
    const f = fixture({ files: file ? [file] : [] });
    await expect(
      f.execute({
        message: { id: "message", parts: [{ type: "file", fileId: "file" }] },
      }),
    ).rejects.toThrow();
    expect(f.db.insert).not.toHaveBeenCalled();
    expect(f.db.patch).not.toHaveBeenCalled();
  },
);
it("deduplicates explicit and part attachment IDs and preserves hidden initial messages", async () => {
  const f = fixture({
    files: [{ _id: "file", user_id: "owner", is_attached: false }],
  });
  await f.execute({
    message: {
      id: "message",
      parts: [{ type: "file", fileId: "file" }],
      fileIds: ["file", "file"],
      isHidden: true,
    },
  });
  expect(f.tables.messages[0]).toMatchObject({
    file_ids: ["file"],
    is_hidden: true,
  });
  expect(f.tables.files[0].is_attached).toBe(true);
});
it("accepts regeneration with no message without changing existing content", async () => {
  const f = fixture({ chats: [chat()], messages: [message()] });
  await f.execute({ allowCreate: false, message: undefined });
  expect(f.db.insert).not.toHaveBeenCalled();
  expect(f.db.patch).not.toHaveBeenCalled();
});
it.each([
  { _id: "project", user_id: "foreign", type: "app" },
  { _id: "project", user_id: "owner", type: "app", archived_at: NOW },
  { _id: "project", user_id: "owner", type: "image" },
])("rejects invalid project binding atomically (%j)", async (project) => {
  const f = fixture({ projects: [project] });
  await expect(f.execute({ projectId: "project" })).rejects.toThrow();
  expect(f.db.insert).not.toHaveBeenCalled();
  expect(f.db.patch).not.toHaveBeenCalled();
});
it("allows same-binding archived project retries but rejects rebinding an existing chat", async () => {
  const f = fixture({
    chats: [chat({ project_id: "project", purpose: "app" })],
    projects: [
      { _id: "project", user_id: "owner", type: "app", archived_at: NOW },
    ],
  });
  await f.execute({ projectId: "project" });
  expect(f.tables.messages).toHaveLength(1);
  await expect(f.execute({ projectId: undefined })).rejects.toMatchObject({
    data: { code: "CHAT_ID_CONFLICT" },
  });
});
