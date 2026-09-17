/** @jest-environment node */
import { createReadRunArchive, MAX_ARCHIVE_BYTES } from "../read-run-archive";

const sentinel = "ARCHIVE_ONLY_SENTINEL_419";
const body = JSON.stringify({
  id: "old-message",
  role: "assistant",
  parts: [
    { type: "text", text: "x".repeat(20000) + sentinel + "y".repeat(20000) },
  ],
});
const originalFetch = global.fetch;
const query = jest.fn();
const action = jest.fn();
const fetchMock = jest.fn();
const page = {
  page: [
    {
      id: "old-message",
      role: "assistant",
      parts: [
        {
          type: "file",
          fileId: "owned-archive",
          mediaType: "application/json",
          isRunArchive: true,
          url: "https://expired.example/archive",
        },
      ],
    },
  ],
  isDone: true,
  continueCursor: null,
};
function makeTool() {
  return createReadRunArchive(
    { userID: "owner", chatId: "chat" },
    { client: { query, action } as any, serviceKey: "fixture-key" },
  );
}
const run = (input: any) =>
  makeTool().execute!(input, {
    toolCallId: "test",
    messages: [],
  }) as Promise<any>;
beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue(page);
  action.mockResolvedValue(["https://storage.example/fresh"]);
  fetchMock.mockImplementation(async () => new Response(body));
  global.fetch = fetchMock as any;
});
afterAll(() => {
  global.fetch = originalFetch;
});

it("lists compact trusted references without URL resolution or blob download", async () => {
  const result = await run({ action: "list" });
  expect(result.archives).toEqual([
    { archiveId: "owned-archive", messageId: "old-message" },
  ]);
  expect(query).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      serviceKey: "fixture-key",
      userId: "owner",
      chatId: "chat",
    }),
  );
  expect(action).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(sentinel);
});
it("refreshes the owned URL only on read and finds omitted text in bounded excerpts", async () => {
  const result = await run({
    action: "read",
    archiveId: "owned-archive",
    query: sentinel,
    limit: 100,
  });
  expect(result.ok).toBe(true);
  expect(result.text).toContain(sentinel);
  expect(result.text.length).toBeLessThanOrEqual(100);
  expect(action).toHaveBeenCalledWith(expect.anything(), {
    serviceKey: "fixture-key",
    userId: "owner",
    fileIds: ["owned-archive"],
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://storage.example/fresh",
    expect.objectContaining({ redirect: "error" }),
  );
  const range = await run({
    action: "read",
    archiveId: "owned-archive",
    offset: result.offset,
    limit: 100,
  });
  expect(range.text).toBe(result.text);
});
it("rejects a foreign archive before resolving or fetching it", async () => {
  expect(await run({ action: "read", archiveId: "foreign-id" })).toMatchObject({
    ok: false,
    code: "archive-not-found",
  });
  expect(action).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not authorize an archive from user message metadata", async () => {
  query.mockResolvedValue({
    ...page,
    page: [{ ...page.page[0], role: "user" }],
  });
  expect(
    await run({ action: "read", archiveId: "owned-archive" }),
  ).toMatchObject({ ok: false, code: "archive-not-found" });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("preserves bounded page traversal without fetching earlier blobs", async () => {
  query.mockResolvedValue({
    page: [],
    isDone: false,
    continueCursor: "next-page",
  });
  expect(await run({ action: "list", cursor: "prior-page" })).toMatchObject({
    archives: [],
    nextCursor: "next-page",
  });
  expect(query).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      paginationOpts: { cursor: "prior-page", numItems: 20 },
    }),
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects oversized archives before consuming their body", async () => {
  fetchMock.mockResolvedValue(
    new Response("small", {
      headers: { "content-length": String(MAX_ARCHIVE_BYTES + 1) },
    }),
  );
  expect(
    await run({ action: "read", archiveId: "owned-archive" }),
  ).toMatchObject({ ok: false, code: "archive-too-large" });
});
it("rejects bytes for a different message", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ id: "other", role: "assistant", parts: [] })),
  );
  expect(
    await run({ action: "read", archiveId: "owned-archive" }),
  ).toMatchObject({ ok: false, code: "invalid-archive" });
});
it("does not follow a model-supplied URL", async () => {
  await expect(
    run({
      action: "read",
      archiveId: "owned-archive",
      url: "https://attacker.example",
    }),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects an unowned chat before resolving any archive", async () => {
  query.mockResolvedValue({ page: [], isDone: true, continueCursor: null });
  expect(
    await run({ action: "read", archiveId: "owned-archive" }),
  ).toMatchObject({ ok: false, code: "archive-not-found" });
  expect(action).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("enforces the byte limit when content-length is absent", async () => {
  fetchMock.mockResolvedValue(
    new Response(new Uint8Array(MAX_ARCHIVE_BYTES + 1)),
  );
  expect(
    await run({ action: "read", archiveId: "owned-archive" }),
  ).toMatchObject({ ok: false, code: "archive-too-large" });
});
it("bounds and paginates references within a message page", async () => {
  query.mockResolvedValue({
    ...page,
    page: [
      {
        ...page.page[0],
        parts: Array.from({ length: 45 }, (_, index) => ({
          ...page.page[0].parts[0],
          fileId: `archive-${index}`,
        })),
      },
    ],
  });
  const first = await run({ action: "list" });
  expect(first.archives).toHaveLength(40);
  expect(first.nextReferenceOffset).toBe(40);
  const next = await run({
    action: "list",
    referenceOffset: first.nextReferenceOffset,
  });
  expect(next.archives).toHaveLength(5);
  expect(next.nextReferenceOffset).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("returns no match without fabricating an excerpt", async () => {
  expect(
    await run({
      action: "read",
      archiveId: "owned-archive",
      query: "missing fact",
    }),
  ).toMatchObject({ ok: true, found: false, nextOffset: null });
});
