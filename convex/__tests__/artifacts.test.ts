import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../_generated/server", () => ({
  query: jest.fn((config: any) => config),
}));

jest.mock("convex/values", () => ({
  // Permissive so a new validator in this module cannot break unrelated tests
  // (getFileLineage added v.id / v.optional / v.any here).
  v: new Proxy({}, { get: () => jest.fn(() => "v") }),
  ConvexError: class ConvexError extends Error {
    data: any;

    constructor(data: any) {
      super(typeof data === "string" ? data : data.message);
      this.data = data;
      this.name = "ConvexError";
    }
  },
}));

const USER_ID = "user-1";

function message(
  id: string,
  parts: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    _id: id,
    _creationTime: 1,
    id,
    chat_id: `chat-${id}`,
    user_id: USER_ID,
    role: "assistant",
    parts,
    update_time: 100,
    ...overrides,
  };
}

function createContext({
  messages = [],
  files = {},
  storageUrls = {},
}: {
  messages?: Record<string, any>[];
  files?: Record<string, Record<string, any> | Error | null>;
  storageUrls?: Record<string, string | null>;
} = {}) {
  const eq = jest.fn<any>().mockReturnThis();
  const take = jest.fn<any>().mockResolvedValue(messages);
  const paginate = jest
    .fn<any>()
    .mockResolvedValue({ page: messages, isDone: true, continueCursor: "" });
  const order = jest.fn(() => ({ take, paginate }));
  const withIndex = jest.fn((_name: string, predicate: any) => {
    predicate({ eq });
    return { order };
  });
  const get = jest.fn<any>(async (fileId: string) => {
    const file = files[fileId];
    if (file instanceof Error) throw file;
    return file ?? null;
  });
  const getUrl = jest.fn<any>(async (storageId: string) => {
    return storageUrls[storageId] ?? null;
  });

  return {
    ctx: {
      auth: {
        getUserIdentity: jest
          .fn<any>()
          .mockResolvedValue({ subject: `${USER_ID}|session-1` }),
      },
      db: {
        query: jest.fn(() => ({ withIndex })),
        get,
      },
      storage: { getUrl },
    },
    eq,
    take,
    paginate,
    withIndex,
    get,
    getUrl,
  };
}

describe("artifacts.listForUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("bounds bytes read so large conversation histories cannot exhaust the transaction", async () => {
    const { ctx, take, paginate } = createContext();
    const { listForUser } = await import("../artifacts");
    await (listForUser as any).handler(ctx, {});
    expect(take).not.toHaveBeenCalled();
    expect(paginate).toHaveBeenCalledWith(
      expect.objectContaining({
        maximumBytesRead: 8 * 1024 * 1024,
        cursor: null,
      }),
    );
  });

  it("stops legacy file recovery before inline content consumes the remaining read budget", async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `large-file-${index}`);
    const { ctx, get } = createContext({
      messages: [
        message(
          "large",
          ids.map((fileId) => ({
            type: "file",
            fileId,
            mediaType: "image/png",
          })),
        ),
      ],
      files: Object.fromEntries(
        ids.map((id) => [
          id,
          { _id: id, user_id: USER_ID, content: "x".repeat(600_000) },
        ]),
      ),
    });
    const { listForUser } = await import("../artifacts");
    await (listForUser as any).handler(ctx, {});
    expect(get.mock.calls.length).toBeGreaterThan(0);
    expect(get.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("requires authentication before reading messages", async () => {
    const ctx: any = {
      auth: { getUserIdentity: jest.fn<any>().mockResolvedValue(null) },
      db: { query: jest.fn() },
    };
    const { listForUser } = await import("../artifacts");

    await expect((listForUser as any).handler(ctx, {})).rejects.toMatchObject({
      data: expect.objectContaining({ code: "UNAUTHORIZED" }),
    });
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("lists generated and uploaded videos alongside images", async () => {
    const { ctx, eq, paginate, withIndex, get } = createContext({
      messages: [
        message("newest", [
          {
            type: "tool-generate_video",
            output: { url: "https://media.test/generated.mp4" },
          },
          {
            type: "tool-generate_image",
            output: {
              url: "https://media.test/generated.webp",
              mediaType: "image/webp",
            },
          },
          {
            type: "file",
            url: "https://media.test/uploaded.webm",
            mimeType: "video/webm",
          },
          {
            type: "file",
            url: "https://media.test/notes.txt",
            mediaType: "text/plain",
          },
          {
            type: "tool-generate_video",
            output: { url: "https://media.test/generated.mp4" },
          },
        ]),
      ],
    });
    const { listForUser } = await import("../artifacts");

    const result = await (listForUser as any).handler(ctx, {});

    expect(ctx.db.query).toHaveBeenCalledWith("messages");
    expect(withIndex).toHaveBeenCalledWith("by_user_id", expect.any(Function));
    expect(eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(paginate).toHaveBeenCalledWith({
      numItems: 800,
      cursor: null,
      maximumBytesRead: 8 * 1024 * 1024,
    });
    expect(get).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        url: "https://media.test/generated.mp4",
        mediaType: "video/mp4",
        kind: "generated",
        chat_id: "chat-newest",
        time: 100,
      },
      {
        url: "https://media.test/generated.webp",
        mediaType: "image/webp",
        kind: "generated",
        chat_id: "chat-newest",
        time: 100,
      },
      {
        url: "https://media.test/uploaded.webm",
        mediaType: "video/webm",
        kind: "uploaded",
        chat_id: "chat-newest",
        time: 100,
      },
    ]);
  });

  it("recovers owned Convex media URLs from persisted file IDs", async () => {
    const { ctx, getUrl } = createContext({
      messages: [
        message("persisted", [
          {
            type: "tool-generate_video",
            output: { fileId: "file-video", mediaType: "video/mp4" },
          },
          {
            type: "file",
            fileId: "file-upload",
            name: "reference.mov",
          },
          {
            type: "file",
            fileId: "file-other-user",
            mediaType: "video/mp4",
          },
          {
            type: "file",
            fileId: "file-s3-only",
            mediaType: "image/png",
          },
          {
            type: "file",
            fileId: "malformed-id",
            mediaType: "video/mp4",
          },
        ]),
      ],
      files: {
        "file-video": {
          _id: "file-video",
          user_id: USER_ID,
          storage_id: "storage-video",
          media_type: "video/mp4",
        },
        "file-upload": {
          _id: "file-upload",
          user_id: USER_ID,
          storage_id: "storage-upload",
          media_type: "video/quicktime",
        },
        "file-other-user": {
          _id: "file-other-user",
          user_id: "user-2",
          storage_id: "storage-private",
          media_type: "video/mp4",
        },
        "file-s3-only": {
          _id: "file-s3-only",
          user_id: USER_ID,
          s3_key: "private/user-1/image.png",
          media_type: "image/png",
        },
        "malformed-id": new Error("Invalid Convex id"),
      },
      storageUrls: {
        "storage-video": "https://convex.test/generated-video",
        "storage-upload": "https://convex.test/uploaded-video",
        "storage-private": "https://convex.test/must-not-leak",
      },
    });
    const { listForUser } = await import("../artifacts");

    const result = await (listForUser as any).handler(ctx, {});

    expect(result).toEqual([
      {
        url: "https://convex.test/generated-video",
        mediaType: "video/mp4",
        kind: "generated",
        chat_id: "chat-persisted",
        time: 100,
      },
      {
        url: "https://convex.test/uploaded-video",
        mediaType: "video/quicktime",
        kind: "uploaded",
        chat_id: "chat-persisted",
        time: 100,
      },
    ]);
    expect(getUrl).toHaveBeenCalledTimes(2);
    expect(getUrl).toHaveBeenCalledWith("storage-video");
    expect(getUrl).toHaveBeenCalledWith("storage-upload");
    expect(getUrl).not.toHaveBeenCalledWith("storage-private");
  });

  it("deduplicates a persisted generation by file identity", async () => {
    const { ctx } = createContext({
      messages: [
        message("duplicate", [
          {
            type: "file",
            fileId: "file-video",
            mediaType: "video/mp4",
          },
          {
            type: "tool-generate_video",
            output: { fileId: "file-video" },
          },
        ]),
      ],
      files: {
        "file-video": {
          _id: "file-video",
          user_id: USER_ID,
          storage_id: "storage-video",
          media_type: "video/mp4",
        },
      },
      storageUrls: {
        "storage-video": "https://convex.test/generated-video",
      },
    });
    const { listForUser } = await import("../artifacts");

    await expect((listForUser as any).handler(ctx, {})).resolves.toEqual([
      expect.objectContaining({
        url: "https://convex.test/generated-video",
        mediaType: "video/mp4",
        kind: "generated",
      }),
    ]);
  });
});
