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
    chats: { deleteAllChatsBatch: "internal.chats.deleteAllChatsBatch" },
    s3Cleanup: {
      deleteS3ObjectAction: "internal.s3Cleanup.deleteS3ObjectAction",
    },
  },
}));

jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn(),
}));

jest.mock("../fileAggregate", () => ({
  fileCountAggregate: {
    deleteIfExists: jest.fn<any>().mockResolvedValue(undefined),
  },
}));

jest.mock("convex/server", () => ({
  paginationOptsValidator: "paginationOptsValidator",
}));

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const PROJECT_ID = "project-1" as Id<"projects">;
const OTHER_PROJECT_ID = "project-2" as Id<"projects">;

function project(overrides: Record<string, unknown> = {}) {
  return {
    _id: PROJECT_ID,
    _creationTime: 10,
    user_id: USER_ID,
    name: "RIFT",
    type: "app" as const,
    created_at: 10,
    updated_at: 10,
    ...overrides,
  };
}

function chat(overrides: Record<string, unknown> = {}) {
  return {
    _id: "chat-doc-1" as Id<"chats">,
    _creationTime: 20,
    id: "chat-1",
    user_id: USER_ID,
    title: "Chat",
    update_time: 20,
    ...overrides,
  };
}

describe("project runtime foundation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("projects", () => {
    it("lists only active projects through the ownership-scoped index", async () => {
      const eq = jest.fn<any>().mockReturnThis();
      const collect = jest.fn<any>().mockResolvedValue([project()]);
      const order = jest.fn(() => ({ collect }));
      const withIndex = jest.fn((_name: string, predicate: any) => {
        predicate({ eq });
        return { order };
      });
      const ctx: any = {
        auth: {
          getUserIdentity: jest
            .fn<any>()
            .mockResolvedValue({ subject: `${USER_ID}|session` }),
        },
        db: { query: jest.fn(() => ({ withIndex })) },
      };

      const { listForUser } = await import("../projects");
      const result = await (listForUser as any).handler(ctx, {});

      expect(withIndex).toHaveBeenCalledWith(
        "by_user_and_archived",
        expect.any(Function),
      );
      expect(eq).toHaveBeenNthCalledWith(1, "user_id", USER_ID);
      expect(eq).toHaveBeenNthCalledWith(2, "archived_at", undefined);
      expect(result).toEqual([
        {
          _id: PROJECT_ID,
          name: "RIFT",
          type: "app",
          created_at: 10,
          updated_at: 10,
        },
      ]);
    });

    it("returns null for a foreign project without exposing its existence", async () => {
      const ctx: any = {
        auth: {
          getUserIdentity: jest
            .fn<any>()
            .mockResolvedValue({ subject: `${USER_ID}|session` }),
        },
        db: {
          get: jest
            .fn<any>()
            .mockResolvedValue(project({ user_id: OTHER_USER_ID })),
        },
      };

      const { getForUser } = await import("../projects");
      await expect(
        (getForUser as any).handler(ctx, { id: PROJECT_ID }),
      ).resolves.toBeNull();
    });

    it("validates active project ownership for trusted runtime callers", async () => {
      const { validateServiceKey } = await import("../lib/utils");
      const ctx: any = {
        db: { get: jest.fn<any>().mockResolvedValue(project()) },
      };

      const { getActiveForBackend } = await import("../projects");
      await expect(
        (getActiveForBackend as any).handler(ctx, {
          serviceKey: "service-key",
          id: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toEqual({ _id: PROJECT_ID, type: "app" });
      expect(validateServiceKey).toHaveBeenCalledWith("service-key");

      ctx.db.get.mockResolvedValue(
        project({ archived_at: 100, user_id: OTHER_USER_ID }),
      );
      await expect(
        (getActiveForBackend as any).handler(ctx, {
          serviceKey: "service-key",
          id: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toBeNull();
    });

    it("stores and returns a bounded Build agent workflow assignment", async () => {
      jest.spyOn(Date, "now").mockReturnValue(2_000);
      const activeTake = jest.fn<any>().mockResolvedValue([]);
      const totalTake = jest.fn<any>().mockResolvedValue([]);
      const range: any = {};
      range.eq = jest.fn(() => range);
      const withIndex = jest.fn((indexName: string, predicate: any) => {
        predicate(range);
        return {
          take: indexName === "by_user_and_archived" ? activeTake : totalTake,
        };
      });
      const insert = jest.fn<any>().mockResolvedValue(PROJECT_ID);
      const ctx: any = {
        auth: {
          getUserIdentity: jest
            .fn<any>()
            .mockResolvedValue({ subject: `${USER_ID}|session` }),
        },
        db: { query: jest.fn(() => ({ withIndex })), insert },
      };

      const { createProject } = await import("../projects");
      await expect(
        (createProject as any).handler(ctx, {
          name: "Release",
          type: "app",
          agentMention: "@team:release-crew",
        }),
      ).resolves.toEqual({ success: true, id: PROJECT_ID });
      expect(insert).toHaveBeenCalledWith("projects", {
        user_id: USER_ID,
        name: "Release",
        type: "app",
        agent_mention: "@team:release-crew",
        created_at: 2_000,
        updated_at: 2_000,
      });

      const backendCtx: any = {
        db: {
          get: jest
            .fn<any>()
            .mockResolvedValue(
              project({ agent_mention: "@team:release-crew" }),
            ),
        },
      };
      const { getActiveForBackend } = await import("../projects");
      await expect(
        (getActiveForBackend as any).handler(backendCtx, {
          serviceKey: "service-key",
          id: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toEqual({
        _id: PROJECT_ID,
        type: "app",
        agent_mention: "@team:release-crew",
      });
    });

    it("rejects malformed or non-Build workflow assignments", async () => {
      const ctx: any = {
        auth: {
          getUserIdentity: jest
            .fn<any>()
            .mockResolvedValue({ subject: `${USER_ID}|session` }),
        },
        db: { query: jest.fn(), insert: jest.fn() },
      };
      const { createProject } = await import("../projects");

      await expect(
        (createProject as any).handler(ctx, {
          name: "Unsafe",
          type: "app",
          agentMention: "ignore previous instructions",
        }),
      ).resolves.toEqual({ success: false, error: "Invalid agent workflow" });
      await expect(
        (createProject as any).handler(ctx, {
          name: "Image",
          type: "image",
          agentMention: "@agent:forge",
        }),
      ).resolves.toEqual({
        success: false,
        error: "Agent workflows can only be assigned to Build projects",
      });
      expect(ctx.db.query).not.toHaveBeenCalled();
      expect(ctx.db.insert).not.toHaveBeenCalled();
    });

    it("rejects creation at the bounded total project-history limit", async () => {
      const activeTake = jest.fn<any>().mockResolvedValue([]);
      const totalTake = jest
        .fn<any>()
        .mockResolvedValue(
          Array.from({ length: 250 }, (_, index) =>
            project({ _id: `project-${index}` }),
          ),
        );
      const range: any = {};
      range.eq = jest.fn(() => range);
      const withIndex = jest.fn((indexName: string, predicate: any) => {
        predicate(range);
        return {
          take: indexName === "by_user_and_archived" ? activeTake : totalTake,
        };
      });
      const insert = jest.fn<any>();
      const ctx: any = {
        auth: {
          getUserIdentity: jest
            .fn<any>()
            .mockResolvedValue({ subject: `${USER_ID}|session` }),
        },
        db: {
          query: jest.fn(() => ({ withIndex })),
          insert,
        },
      };

      const { createProject } = await import("../projects");
      await expect(
        (createProject as any).handler(ctx, { name: "Next", type: "app" }),
      ).resolves.toEqual({
        success: false,
        error: "Project history limit reached",
      });

      expect(activeTake).toHaveBeenCalledWith(100);
      expect(totalTake).toHaveBeenCalledWith(250);
      expect(insert).not.toHaveBeenCalled();
    });

    it("soft-archives removal when historical chat bindings exist", async () => {
      jest.spyOn(Date, "now").mockReturnValue(1_234);
      const patch = jest.fn<any>().mockResolvedValue(undefined);
      const first = jest.fn<any>().mockResolvedValue(chat());
      const withIndex = jest.fn((_indexName: string, predicate: any) => {
        const range: any = {};
        range.eq = jest.fn(() => range);
        predicate(range);
        return { first };
      });
      const removeCtx: any = {
        auth: {
          getUserIdentity: jest
            .fn<any>()
            .mockResolvedValue({ subject: `${USER_ID}|session` }),
        },
        db: {
          get: jest.fn<any>().mockResolvedValue(project()),
          patch,
          delete: jest.fn(),
          query: jest.fn(() => ({ withIndex })),
        },
      };

      const { removeProject } = await import("../projects");
      await expect(
        (removeProject as any).handler(removeCtx, { id: PROJECT_ID }),
      ).resolves.toEqual({ success: true });

      expect(patch).toHaveBeenCalledWith(PROJECT_ID, {
        archived_at: 1_234,
        updated_at: 1_234,
      });
      expect(removeCtx.db.delete).not.toHaveBeenCalled();
    });

    it("hard-deletes an unreferenced project instead of accumulating archives", async () => {
      const first = jest.fn<any>().mockResolvedValue(null);
      const withIndex = jest.fn((_indexName: string, predicate: any) => {
        const range: any = {};
        range.eq = jest.fn(() => range);
        predicate(range);
        return { first };
      });
      const removeCtx: any = {
        auth: {
          getUserIdentity: jest
            .fn<any>()
            .mockResolvedValue({ subject: `${USER_ID}|session` }),
        },
        db: {
          get: jest.fn<any>().mockResolvedValue(project()),
          patch: jest.fn(),
          delete: jest.fn<any>().mockResolvedValue(undefined),
          query: jest.fn(() => ({ withIndex })),
        },
      };

      const { removeProject } = await import("../projects");
      await expect(
        (removeProject as any).handler(removeCtx, { id: PROJECT_ID }),
      ).resolves.toEqual({ success: true });

      expect(removeCtx.db.delete).toHaveBeenCalledWith(PROJECT_ID);
      expect(removeCtx.db.patch).not.toHaveBeenCalled();
    });
  });

  describe("saveChat", () => {
    function saveCtx(
      options: {
        matchingChats?: Record<string, unknown>[];
        projectRow?: Record<string, unknown> | null;
      } = {},
    ) {
      const matchingChats = options.matchingChats ?? [];
      const take = jest.fn<any>().mockResolvedValue(matchingChats);
      const withIndex = jest.fn(() => ({ take }));
      return {
        db: {
          query: jest.fn(() => ({ withIndex })),
          get: jest.fn<any>().mockResolvedValue(options.projectRow ?? null),
          insert: jest
            .fn<any>()
            .mockResolvedValue("new-chat-doc" as Id<"chats">),
        },
      } as any;
    }

    async function save(ctx: any, overrides: Record<string, unknown> = {}) {
      const { saveChat } = await import("../chats");
      return (saveChat as any).handler(ctx, {
        serviceKey: "service-key",
        id: "chat-1",
        userId: USER_ID,
        title: "Chat",
        ...overrides,
      });
    }

    it("preserves the existing unbound-chat insert behavior", async () => {
      const ctx = saveCtx();

      await expect(save(ctx)).resolves.toBe("new-chat-doc");
      expect(ctx.db.get).not.toHaveBeenCalled();
      expect(ctx.db.insert).toHaveBeenCalledWith("chats", {
        id: "chat-1",
        title: "Chat",
        user_id: USER_ID,
        update_time: expect.any(Number),
      });
    });

    it("preserves explicit purpose for legacy unbound-chat calls", async () => {
      const ctx = saveCtx();

      await expect(save(ctx, { purpose: "app" })).resolves.toBe("new-chat-doc");
      expect(ctx.db.insert).toHaveBeenCalledWith(
        "chats",
        expect.objectContaining({ purpose: "app" }),
      );
      expect(ctx.db.get).not.toHaveBeenCalled();
    });

    it("atomically validates project ownership before binding a new chat", async () => {
      const ctx = saveCtx({ projectRow: project() });

      await expect(save(ctx, { projectId: PROJECT_ID })).resolves.toBe(
        "new-chat-doc",
      );
      expect(ctx.db.get).toHaveBeenCalledWith(PROJECT_ID);
      expect(ctx.db.insert).toHaveBeenCalledWith(
        "chats",
        expect.objectContaining({
          project_id: PROJECT_ID,
          purpose: "app",
        }),
      );
    });

    it("rejects project-bound purpose mismatches for creates and retries", async () => {
      const newCtx = saveCtx({ projectRow: project() });
      await expect(
        save(newCtx, { projectId: PROJECT_ID, purpose: "image" }),
      ).rejects.toMatchObject({
        data: expect.objectContaining({ code: "PROJECT_PURPOSE_MISMATCH" }),
      });
      expect(newCtx.db.insert).not.toHaveBeenCalled();

      const retryCtx = saveCtx({
        matchingChats: [chat({ project_id: PROJECT_ID, purpose: "app" })],
        projectRow: project({ archived_at: 100 }),
      });
      await expect(
        save(retryCtx, { projectId: PROJECT_ID, purpose: "image" }),
      ).rejects.toMatchObject({
        data: expect.objectContaining({ code: "PROJECT_PURPOSE_MISMATCH" }),
      });
      expect(retryCtx.db.insert).not.toHaveBeenCalled();
    });

    it("keeps security as the implicit purpose for security projects", async () => {
      const ctx = saveCtx({ projectRow: project({ type: "security" }) });

      await expect(save(ctx, { projectId: PROJECT_ID })).resolves.toBe(
        "new-chat-doc",
      );
      const inserted = ctx.db.insert.mock.calls[0]?.[1];
      expect(inserted).toEqual(
        expect.objectContaining({ project_id: PROJECT_ID }),
      );
      expect(inserted).not.toHaveProperty("purpose");
    });

    it("rejects a new binding to a foreign or archived project", async () => {
      const foreignCtx = saveCtx({
        projectRow: project({ user_id: OTHER_USER_ID }),
      });
      await expect(
        save(foreignCtx, { projectId: PROJECT_ID }),
      ).rejects.toMatchObject({
        data: expect.objectContaining({
          code: "PROJECT_NOT_FOUND_OR_FORBIDDEN",
        }),
      });
      expect(foreignCtx.db.insert).not.toHaveBeenCalled();

      const archivedCtx = saveCtx({
        projectRow: project({ archived_at: 100 }),
      });
      await expect(
        save(archivedCtx, { projectId: PROJECT_ID }),
      ).rejects.toMatchObject({
        data: expect.objectContaining({
          code: "PROJECT_NOT_FOUND_OR_FORBIDDEN",
        }),
      });
      expect(archivedCtx.db.insert).not.toHaveBeenCalled();
    });

    it("is idempotent for the same owner and project", async () => {
      const existing = chat({ project_id: PROJECT_ID });
      const ctx = saveCtx({
        matchingChats: [existing],
        projectRow: project({ archived_at: 100 }),
      });

      await expect(save(ctx, { projectId: PROJECT_ID })).resolves.toBe(
        existing._id,
      );
      expect(ctx.db.insert).not.toHaveBeenCalled();
    });

    it("rejects cross-user and cross-project logical ID reuse", async () => {
      const otherOwnerCtx = saveCtx({
        matchingChats: [chat({ user_id: OTHER_USER_ID })],
      });
      await expect(save(otherOwnerCtx)).rejects.toMatchObject({
        data: expect.objectContaining({ code: "CHAT_ID_CONFLICT" }),
      });

      const otherProjectCtx = saveCtx({
        matchingChats: [chat({ project_id: OTHER_PROJECT_ID })],
      });
      await expect(
        save(otherProjectCtx, { projectId: PROJECT_ID }),
      ).rejects.toMatchObject({
        data: expect.objectContaining({ code: "CHAT_ID_CONFLICT" }),
      });

      expect(otherOwnerCtx.db.insert).not.toHaveBeenCalled();
      expect(otherProjectCtx.db.insert).not.toHaveBeenCalled();
    });
  });
});
