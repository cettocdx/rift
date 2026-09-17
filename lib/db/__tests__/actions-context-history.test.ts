import { WorkerChatSnapshot } from "../worker-chat-snapshot";
import { getMessagesByChatId } from "../actions";

const mockQuery = jest.fn();
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("../convex-client", () => ({
  ...jest.requireActual<typeof import("../convex-client")>("../convex-client"),
  getConvexClient: () => ({ query: mockQuery }),
  setConvexUrl: jest.fn(),
}));

const message = (index: number) => ({
  id: `message-${index}`,
  role: index % 2 ? "assistant" : "user",
  parts: [{ type: "text", text: `item ${index} ${"token ".repeat(1_500)}` }],
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (_ref, args) => {
    if (!args.paginationOpts)
      return { id: "chat-1", user_id: "user-1", purpose: "app" };
    const page = Number(args.paginationOpts.cursor ?? 0);
    return {
      page: Array.from({ length: 24 }, (_, i) => message(143 - page * 24 - i)),
      isDone: page === 5,
      continueCursor: page < 5 ? String(page + 1) : null,
    };
  });
});

const load = (
  subscription: "pro" | "free",
  hasPaidContext = false,
  extras: Record<string, unknown> = {},
) =>
  getMessagesByChatId({
    chatId: "chat-1",
    userId: "user-1",
    subscription,
    newMessages: [
      {
        id: "latest",
        role: "user",
        parts: [{ type: "text", text: "continue" }],
      },
    ],
    mode: "agent",
    context: { model: "build-balanced", hasPaidContext },
    ...extras,
  });

it("loads past 96 messages and 200k tokens when the selected model supports it", async () => {
  const result = await load("pro");
  expect(result.truncatedMessages).toHaveLength(145);
  expect(result.truncatedMessages[0].id).toBe("message-0");
  expect(result.truncatedMessages.at(-1)?.id).toBe("latest");
  expect(
    mockQuery.mock.calls.filter(([, args]) => args.paginationOpts),
  ).toHaveLength(6);
});

it("keeps the free input budget and newest message", async () => {
  const result = await load("free");
  expect(result.truncatedMessages.length).toBeLessThan(96);
  expect(result.truncatedMessages[0].id).not.toBe("message-0");
  expect(result.truncatedMessages.at(-1)?.id).toBe("latest");
});

it("uses the same larger backfill for verified prepaid capacity", async () => {
  const result = await load("free", true);
  expect(result.truncatedMessages[0].id).toBe("message-0");
  expect(result.truncatedMessages).toHaveLength(145);
});

const snapshotOwner = { userId: "user-1", chatId: "chat-1", runId: "run-1" };
it.each([
  ["pro", false],
  ["free", false],
  ["free", true],
] as const)(
  "claim snapshot preserves %s history and removes exactly one read (paid=%s)",
  async (subscription, paid) => {
    const expected = await load(subscription, paid);
    const previousCalls = mockQuery.mock.calls.length;
    mockQuery.mockClear();
    const snapshot = new WorkerChatSnapshot(snapshotOwner, {
      id: "chat-1",
      user_id: "user-1",
      purpose: "app",
    } as any);
    const actual = await load(subscription, paid, {
      workerChatSnapshot: snapshot,
      workerRunId: "run-1",
    });
    expect(actual).toEqual(expected);
    expect(mockQuery).toHaveBeenCalledTimes(previousCalls - 1);
    expect(mockQuery.mock.calls.every(([, args]) => args.paginationOpts)).toBe(
      true,
    );
  },
);
it("confirmed absent and omitted snapshot are distinct", async () => {
  const absent = new WorkerChatSnapshot(snapshotOwner, null);
  const result = await load("pro", false, {
    workerChatSnapshot: absent,
    workerRunId: "run-1",
  });
  expect(result.chat).toBeNull();
  expect(mockQuery).not.toHaveBeenCalled();
  await load("pro");
  expect(mockQuery).toHaveBeenCalled();
});
it("rejects wrong owner, chat, run, and request-shaped snapshot objects before reads", async () => {
  const snapshot = new WorkerChatSnapshot(snapshotOwner, {
    id: "chat-1",
    user_id: "user-1",
  } as any);
  for (const extras of [
    { workerChatSnapshot: snapshot, workerRunId: "wrong" },
    { workerChatSnapshot: snapshot, workerRunId: "run-1", userId: "other" },
    { workerChatSnapshot: snapshot, workerRunId: "run-1", chatId: "other" },
    {
      workerChatSnapshot: JSON.parse(JSON.stringify(snapshot)),
      workerRunId: "run-1",
    },
  ])
    await expect(load("pro", false, extras)).rejects.toThrow();
  expect(mockQuery).not.toHaveBeenCalled();
});
it("temporary history never consumes persisted snapshot or queries the database", async () => {
  const snapshot = new WorkerChatSnapshot(snapshotOwner, {
    id: "chat-1",
    user_id: "user-1",
    title: "private",
  } as any);
  const result = await load("pro", false, {
    isTemporary: true,
    workerChatSnapshot: snapshot,
    workerRunId: "run-1",
  });
  expect(result.chat).toBeUndefined();
  expect(mockQuery).not.toHaveBeenCalled();
});

it("preserves summary, project metadata, file tokens and regenerate trimming", async () => {
  const chat = {
    id: "chat-1",
    user_id: "user-1",
    purpose: "research",
    project_id: "project-1",
    latest_summary_id: "summary-1",
  } as any;
  mockQuery.mockImplementation(async (_ref, args) => {
    if (args.id) return chat;
    if (args.fileIds) return [321];
    if (!args.paginationOpts)
      return {
        summary_text: "Earlier verified work",
        summary_up_to_message_id: "before",
      };
    return {
      page: [
        {
          id: "assistant-tail",
          role: "assistant",
          parts: [{ type: "text", text: "remove on regenerate" }],
        },
        {
          id: "after",
          role: "user",
          parts: [
            { type: "text", text: "inspect" },
            {
              type: "file",
              fileId: "owned-file",
              mediaType: "application/pdf",
              filename: "report.pdf",
            },
          ],
        },
        {
          id: "before",
          role: "user",
          parts: [{ type: "text", text: "old work" }],
        },
      ],
      isDone: true,
      continueCursor: null,
    };
  });
  const extras = { regenerate: true, mode: "ask" };
  const expected = await load("pro", false, extras);
  const calls = mockQuery.mock.calls.length;
  mockQuery.mockClear();
  const actual = await load("pro", false, {
    ...extras,
    workerChatSnapshot: new WorkerChatSnapshot(snapshotOwner, chat),
    workerRunId: "run-1",
  });
  // Summary message IDs are intentionally minted anew on every load.
  const normalize = (result: typeof actual) => ({
    ...result,
    truncatedMessages: result.truncatedMessages.map((m, i) =>
      i === 0 ? { ...m, id: "summary" } : m,
    ),
  });
  expect(normalize(actual)).toEqual(normalize(expected));
  expect(actual.truncatedMessages.map((m) => m.id).slice(1)).toEqual(["after"]);
  expect(actual.truncatedMessages[0].parts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        text: expect.stringContaining("Earlier verified work"),
      }),
    ]),
  );
  expect(actual.fileTokens).toEqual({ "owned-file": 321 });
  expect(actual.chat?.project_id).toBe("project-1");
  expect(mockQuery).toHaveBeenCalledTimes(calls - 1);
  expect(
    mockQuery.mock.calls.find(([, args]) => args.fileIds)?.[1].userId,
  ).toBe("user-1");
  expect(
    mockQuery.mock.calls.find(([, args]) => args.paginationOpts)?.[1].userId,
  ).toBe("user-1");
});

it("preserves restageable local attachments during explicit client-history regeneration", async () => {
  const extras = {
    regenerate: true,
    useClientMessagesForRegenerate: true,
    newMessages: [
      {
        id: "local-user",
        role: "user",
        parts: [
          { type: "text", text: "inspect" },
          {
            type: "file",
            storage: "local-desktop",
            localPath: "/Users/example/report.pdf",
            name: "report.pdf",
          },
        ],
      },
    ],
  };
  const expected = await load("pro", false, extras);
  expect(mockQuery).toHaveBeenCalledTimes(1);
  mockQuery.mockClear();
  const actual = await load("pro", false, {
    ...extras,
    workerChatSnapshot: new WorkerChatSnapshot(snapshotOwner, {
      id: "chat-1",
      user_id: "user-1",
      purpose: "app",
    } as any),
    workerRunId: "run-1",
  });
  expect(actual).toEqual(expected);
  expect(actual.truncatedMessages[0].parts).toEqual(
    extras.newMessages[0].parts,
  );
  expect(mockQuery).not.toHaveBeenCalled();
});

it("still reads owner-filtered history after activation and never restores persisted input from the request", async () => {
  // A deleted chat (or failed current ownership check) yields an empty backend page.
  mockQuery.mockResolvedValue({ page: [], isDone: true, continueCursor: "" });
  const actual = await load("pro", false, {
    newMessages: [],
    workerChatSnapshot: new WorkerChatSnapshot(snapshotOwner, {
      id: "chat-1",
      user_id: "user-1",
      purpose: "app",
    } as any),
    workerRunId: "run-1",
  });
  expect(actual.truncatedMessages).toEqual([]);
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][1]).toMatchObject({
    chatId: "chat-1",
    userId: "user-1",
    paginationOpts: { numItems: 24, cursor: null },
  });
});

const deferredPaidContext = () => {
  let resolve!: (paid: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settleHistoryTasks = () =>
  new Promise((resolve) => setTimeout(resolve, 0));

it.each([false, true])(
  "overlaps exactly the first history page with verified context (paid=%s)",
  async (paid) => {
    const expected = await load("free", paid);
    const expectedCalls = mockQuery.mock.calls.length;
    mockQuery.mockClear();
    const context = deferredPaidContext();
    let finished = false;
    const pending = load("free", false, {
      hasPaidContextPromise: context.promise,
    });
    void pending.then(() => {
      finished = true;
    });
    await settleHistoryTasks();
    const pages = mockQuery.mock.calls.filter(
      ([, args]) => args.paginationOpts,
    );
    expect(pages).toHaveLength(1);
    expect(pages[0][1].paginationOpts).toEqual({ numItems: 24, cursor: null });
    expect(finished).toBe(false);
    context.resolve(paid);
    await expect(pending).resolves.toEqual(expected);
    expect(mockQuery).toHaveBeenCalledTimes(expectedCalls);
  },
);

it("never falls back to caller messages when deferred context fails", async () => {
  const context = deferredPaidContext();
  const pending = load("free", false, {
    hasPaidContextPromise: context.promise,
  });
  const rejection = expect(pending).rejects.toThrow("context denied");
  await settleHistoryTasks();
  context.reject(new Error("context denied"));
  await rejection;
  expect(
    mockQuery.mock.calls.filter(([, args]) => args.paginationOpts),
  ).toHaveLength(1);
});

it("temporary history waits for context without querying persisted data", async () => {
  const context = deferredPaidContext();
  let finished = false;
  const pending = load("free", false, {
    isTemporary: true,
    hasPaidContextPromise: context.promise,
  });
  void pending.then(() => {
    finished = true;
  });
  await settleHistoryTasks();
  expect(mockQuery).not.toHaveBeenCalled();
  expect(finished).toBe(false);
  context.resolve(false);
  await expect(pending).resolves.toBeDefined();
});

it("observes a first-page failure while context is pending and preserves fallback", async () => {
  const context = deferredPaidContext();
  mockQuery.mockImplementation(async (_ref, args) => {
    if (args.paginationOpts) throw new Error("history unavailable");
    return { id: "chat-1", user_id: "user-1", purpose: "app" };
  });
  let finished = false;
  const pending = load("free", false, {
    hasPaidContextPromise: context.promise,
  });
  void pending.then(() => {
    finished = true;
  });
  await settleHistoryTasks();
  expect(finished).toBe(false);
  context.resolve(false);
  const result = await pending;
  expect(result.truncatedMessages.map((item) => item.id)).toEqual(["latest"]);
  expect(
    mockQuery.mock.calls.filter(([, args]) => args.paginationOpts),
  ).toHaveLength(1);
});

it("observes rejected context even when snapshot validation has already failed", async () => {
  const context = deferredPaidContext();
  await expect(
    load("free", false, {
      hasPaidContextPromise: context.promise,
      workerChatSnapshot: new WorkerChatSnapshot(snapshotOwner, null),
      workerRunId: "wrong",
    }),
  ).rejects.toThrow("claim mismatch");
  context.reject(new Error("late context denial"));
  await settleHistoryTasks();
  expect(mockQuery).not.toHaveBeenCalled();
});

it("retains originating service authority across deferred capacity and later pages", async () => {
  const { withConvexClientScope } = await import("../convex-client-scope");
  const original = process.env.CONVEX_SERVICE_ROLE_KEY;
  const context = deferredPaidContext();
  try {
    process.env.CONVEX_SERVICE_ROLE_KEY = "history-authority-a";
    const pending = withConvexClientScope(
      "https://history-a.convex.cloud",
      () =>
        load("free", false, {
          hasPaidContextPromise: context.promise,
          workerChatSnapshot: new WorkerChatSnapshot(snapshotOwner, {
            id: "chat-1",
            user_id: "user-1",
            purpose: "app",
          } as any),
          workerRunId: "run-1",
        }),
    );
    await settleHistoryTasks();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    process.env.CONVEX_SERVICE_ROLE_KEY = "history-authority-b";
    await withConvexClientScope("https://history-b.convex.cloud", async () => {
      context.resolve(true);
      await pending;
    });
    expect(mockQuery).toHaveBeenCalledTimes(6);
    for (const [, args] of mockQuery.mock.calls) {
      expect(args).toMatchObject({
        serviceKey: "history-authority-a",
        userId: "user-1",
        chatId: "chat-1",
      });
    }
  } finally {
    if (original === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
    else process.env.CONVEX_SERVICE_ROLE_KEY = original;
  }
});
