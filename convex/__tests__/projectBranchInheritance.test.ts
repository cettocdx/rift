import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Id } from "../_generated/dataModel";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: any) => config),
  internalMutation: jest.fn((config: any) => config),
  query: jest.fn((config: any) => config),
  internalQuery: jest.fn((config: any) => config),
}));

jest.mock("convex/values", () => ({
  v: {
    id: jest.fn(() => "id"),
    null: jest.fn(() => "null"),
    string: jest.fn(() => "string"),
    number: jest.fn(() => "number"),
    optional: jest.fn(() => "optional"),
    object: jest.fn(() => "object"),
    union: jest.fn(() => "union"),
    array: jest.fn(() => "array"),
    boolean: jest.fn(() => "boolean"),
    literal: jest.fn(() => "literal"),
    any: jest.fn(() => "any"),
  },
  ConvexError: class ConvexError extends Error {
    data: any;

    constructor(data: any) {
      super(typeof data === "string" ? data : data.message);
      this.data = data;
      this.name = "ConvexError";
    }
  },
}));

jest.mock("../_generated/api", () => ({
  internal: {
    messages: {
      verifyChatOwnership: "internal.messages.verifyChatOwnership",
    },
    s3Cleanup: {
      deleteS3ObjectAction: "internal.s3Cleanup.deleteS3ObjectAction",
    },
  },
}));

jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn(),
  copyChatSummary: jest.fn<any>().mockResolvedValue(undefined),
}));

jest.mock("../fileAggregate", () => ({
  fileCountAggregate: {
    deleteIfExists: jest.fn<any>().mockResolvedValue(undefined),
  },
}));

jest.mock("../lib/logger", () => ({
  convexLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("convex/server", () => ({
  paginationOptsValidator: "paginationOptsValidator",
}));

const OWNER_ID = "owner-1";
const OTHER_USER_ID = "user-2";
const CHAT_ID = "chat-source";
const PROJECT_ID = "project-1" as Id<"projects">;

const sourceChat = {
  _id: "source-chat-doc" as Id<"chats">,
  _creationTime: 10,
  id: CHAT_ID,
  title: "Project work",
  user_id: OWNER_ID,
  update_time: 10,
  purpose: "app",
  project_id: PROJECT_ID,
};

const sourceMessage = {
  _id: "source-message-doc" as Id<"messages">,
  _creationTime: 20,
  id: "message-1",
  chat_id: CHAT_ID,
  user_id: OWNER_ID,
  role: "user" as const,
  parts: [{ type: "text", text: "hello" }],
  content: "hello",
  update_time: 20,
};

const ownedProject = {
  _id: PROJECT_ID,
  _creationTime: 1,
  user_id: OWNER_ID,
  name: "RIFT",
  type: "app" as const,
  created_at: 1,
  updated_at: 1,
};

describe("project inheritance across branches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("inherits an active project and derives its purpose for a message branch", async () => {
    const insert = jest
      .fn<any>()
      .mockResolvedValueOnce("new-chat-doc" as Id<"chats">)
      .mockResolvedValue("new-message-doc" as Id<"messages">);
    const ctx: any = {
      auth: {
        getUserIdentity: jest
          .fn<any>()
          .mockResolvedValue({ subject: `${OWNER_ID}|session` }),
      },
      runQuery: jest.fn<any>().mockResolvedValue(true),
      db: {
        get: jest.fn<any>().mockResolvedValue(ownedProject),
        insert,
        patch: jest.fn<any>().mockResolvedValue(undefined),
        query: jest.fn((table: string) => {
          if (table === "messages") {
            return {
              withIndex: jest.fn(() => ({
                first: jest.fn<any>().mockResolvedValue(sourceMessage),
                order: jest.fn(() => ({
                  collect: jest.fn<any>().mockResolvedValue([sourceMessage]),
                })),
              })),
            };
          }
          return {
            withIndex: jest.fn(() => ({
              first: jest
                .fn<any>()
                .mockResolvedValue({ ...sourceChat, purpose: "image" }),
            })),
          };
        }),
      },
    };

    const { branchChat } = await import("../messages");
    await expect(
      (branchChat as any).handler(ctx, { messageId: sourceMessage.id }),
    ).resolves.toEqual(expect.any(String));

    expect(ctx.db.get).toHaveBeenCalledWith(PROJECT_ID);
    expect(insert).toHaveBeenNthCalledWith(
      1,
      "chats",
      expect.objectContaining({
        user_id: OWNER_ID,
        project_id: PROJECT_ID,
        purpose: "app",
        branched_from_chat_id: CHAT_ID,
      }),
    );
  });

  it("does not bind an archived project to a new message branch", async () => {
    const insert = jest
      .fn<any>()
      .mockResolvedValueOnce("new-chat-doc" as Id<"chats">)
      .mockResolvedValue("new-message-doc" as Id<"messages">);
    const ctx: any = {
      auth: {
        getUserIdentity: jest
          .fn<any>()
          .mockResolvedValue({ subject: `${OWNER_ID}|session` }),
      },
      runQuery: jest.fn<any>().mockResolvedValue(true),
      db: {
        get: jest
          .fn<any>()
          .mockResolvedValue({ ...ownedProject, archived_at: 100 }),
        insert,
        patch: jest.fn<any>().mockResolvedValue(undefined),
        query: jest.fn((table: string) => {
          if (table === "messages") {
            return {
              withIndex: jest.fn(() => ({
                first: jest.fn<any>().mockResolvedValue(sourceMessage),
                order: jest.fn(() => ({
                  collect: jest.fn<any>().mockResolvedValue([sourceMessage]),
                })),
              })),
            };
          }
          return {
            withIndex: jest.fn(() => ({
              first: jest.fn<any>().mockResolvedValue(sourceChat),
            })),
          };
        }),
      },
    };

    const { branchChat } = await import("../messages");
    await expect(
      (branchChat as any).handler(ctx, { messageId: sourceMessage.id }),
    ).resolves.toEqual(expect.any(String));

    const insertedChat = insert.mock.calls[0]?.[1];
    expect(insertedChat).not.toHaveProperty("project_id");
    expect(insertedChat).toEqual(expect.objectContaining({ purpose: "app" }));
  });

  it("drops ownership-scoped project and purpose on a public cross-user fork", async () => {
    const insert = jest
      .fn<any>()
      .mockResolvedValueOnce("fork-chat-doc" as Id<"chats">);
    const ctx: any = {
      auth: {
        getUserIdentity: jest
          .fn<any>()
          .mockResolvedValue({ subject: `${OTHER_USER_ID}|session` }),
      },
      db: {
        get: jest.fn<any>(),
        insert,
        query: jest.fn((table: string) => {
          if (table === "chats") {
            return {
              withIndex: jest.fn(() => ({
                first: jest.fn<any>().mockResolvedValue({
                  ...sourceChat,
                  share_id: "123e4567-e89b-12d3-a456-426614174000",
                  share_date: 100,
                }),
              })),
            };
          }
          return {
            withIndex: jest.fn(() => ({
              order: jest.fn(() => ({
                collect: jest.fn<any>().mockResolvedValue([]),
              })),
            })),
          };
        }),
      },
    };

    const { forkSharedChat } = await import("../sharedChats");
    await (forkSharedChat as any).handler(ctx, {
      shareId: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(ctx.db.get).not.toHaveBeenCalled();
    const insertedChat = insert.mock.calls[0]?.[1];
    expect(insertedChat).toEqual(
      expect.objectContaining({
        user_id: OTHER_USER_ID,
        branched_from_chat_id: CHAT_ID,
      }),
    );
    expect(insertedChat).not.toHaveProperty("project_id");
    expect(insertedChat).not.toHaveProperty("purpose");
  });

  it("inherits project and purpose when an owner forks their own share", async () => {
    const insert = jest
      .fn<any>()
      .mockResolvedValueOnce("fork-chat-doc" as Id<"chats">);
    const ctx: any = {
      auth: {
        getUserIdentity: jest
          .fn<any>()
          .mockResolvedValue({ subject: `${OWNER_ID}|session` }),
      },
      db: {
        get: jest.fn<any>().mockResolvedValue(ownedProject),
        insert,
        query: jest.fn((table: string) => {
          if (table === "chats") {
            return {
              withIndex: jest.fn(() => ({
                first: jest.fn<any>().mockResolvedValue({
                  ...sourceChat,
                  share_id: "123e4567-e89b-12d3-a456-426614174000",
                  share_date: 100,
                }),
              })),
            };
          }
          return {
            withIndex: jest.fn(() => ({
              order: jest.fn(() => ({
                collect: jest.fn<any>().mockResolvedValue([]),
              })),
            })),
          };
        }),
      },
    };

    const { forkSharedChat } = await import("../sharedChats");
    await (forkSharedChat as any).handler(ctx, {
      shareId: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(insert).toHaveBeenCalledWith(
      "chats",
      expect.objectContaining({
        user_id: OWNER_ID,
        project_id: PROJECT_ID,
        purpose: "app",
      }),
    );
  });

  it("does not bind an archived project when an owner forks their own share", async () => {
    const insert = jest
      .fn<any>()
      .mockResolvedValueOnce("fork-chat-doc" as Id<"chats">);
    const ctx: any = {
      auth: {
        getUserIdentity: jest
          .fn<any>()
          .mockResolvedValue({ subject: `${OWNER_ID}|session` }),
      },
      db: {
        get: jest
          .fn<any>()
          .mockResolvedValue({ ...ownedProject, archived_at: 100 }),
        insert,
        query: jest.fn((table: string) => {
          if (table === "chats") {
            return {
              withIndex: jest.fn(() => ({
                first: jest.fn<any>().mockResolvedValue({
                  ...sourceChat,
                  share_id: "123e4567-e89b-12d3-a456-426614174000",
                  share_date: 100,
                }),
              })),
            };
          }
          return {
            withIndex: jest.fn(() => ({
              order: jest.fn(() => ({
                collect: jest.fn<any>().mockResolvedValue([]),
              })),
            })),
          };
        }),
      },
    };

    const { forkSharedChat } = await import("../sharedChats");
    await (forkSharedChat as any).handler(ctx, {
      shareId: "123e4567-e89b-12d3-a456-426614174000",
    });

    const insertedChat = insert.mock.calls[0]?.[1];
    expect(insertedChat).not.toHaveProperty("project_id");
    expect(insertedChat).toEqual(expect.objectContaining({ purpose: "app" }));
  });
});
