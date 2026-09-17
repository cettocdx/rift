import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";

// Mock dependencies
jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config) => config),
  internalMutation: jest.fn((config) => config),
}));
jest.mock("convex/values", () => ({
  v: {
    null: jest.fn(() => "null"),
    string: jest.fn(() => "string"),
  },
}));
jest.mock("../_generated/api", () => ({
  internal: {
    userDeletion: {
      deleteTasksAndProjectsBatch: "deleteTasksAndProjectsBatch",
    },
    s3Cleanup: {
      deleteS3ObjectsBatchAction: "deleteS3ObjectsBatchAction",
    },
  },
}));

const mockFileCountAggregate = {
  deleteIfExists: jest.fn().mockResolvedValue(undefined),
};

jest.mock("../fileAggregate", () => ({
  fileCountAggregate: mockFileCountAggregate,
}));

describe("userDeletion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("deleteAllUserData", () => {
    it("should delete S3 files using batch deletion", async () => {
      const { deleteAllUserData } = await import("../userDeletion");

      const mockScheduler = {
        runAfter: jest.fn(),
      };

      const mockDb = {
        query: jest.fn(),
        delete: jest.fn(),
      };

      const mockStorage = {
        delete: jest.fn(),
      };

      const mockAuth = {
        getUserIdentity: jest.fn().mockResolvedValue({
          subject: "user123",
        }),
      };

      // Mock files with both S3 and Convex storage
      const mockFiles = [
        {
          _id: "file1",
          s3_key: "users/user123/file1.pdf",
          user_id: "user123",
          name: "file1.pdf",
          media_type: "application/pdf",
          size: 1000,
          file_token_size: 100,
          is_attached: true,
        },
        {
          _id: "file2",
          s3_key: "users/user123/file2.jpg",
          user_id: "user123",
          name: "file2.jpg",
          media_type: "image/jpeg",
          size: 2000,
          file_token_size: 200,
          is_attached: true,
        },
        {
          _id: "file3",
          storage_id: "storage123",
          user_id: "user123",
          name: "file3.txt",
          media_type: "text/plain",
          size: 500,
          file_token_size: 50,
          is_attached: true,
        },
      ];

      // Setup query mocks
      const mockQueryBuilder = {
        withIndex: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        collect: jest.fn(),
        take: jest.fn().mockResolvedValue([]),
        first: jest.fn(),
      };

      mockDb.query.mockReturnValue(mockQueryBuilder);

      // Mock query results
      mockQueryBuilder.collect
        .mockResolvedValueOnce([]) // chats
        .mockResolvedValueOnce(mockFiles) // files
        .mockResolvedValueOnce([]) // memories
        .mockResolvedValueOnce([]) // notes
        .mockResolvedValueOnce([]); // messages

      mockQueryBuilder.first.mockResolvedValue(null); // user_customization

      const mockCtx = {
        auth: mockAuth,
        db: mockDb,
        storage: mockStorage,
        scheduler: mockScheduler,
      };

      await deleteAllUserData.handler(mockCtx, {});

      // Verify S3 files were collected and scheduled for batch deletion
      expect(mockScheduler.runAfter).toHaveBeenCalledWith(
        0,
        "deleteS3ObjectsBatchAction",
        {
          s3Keys: ["users/user123/file1.pdf", "users/user123/file2.jpg"],
        },
      );

      // Verify Convex storage file was deleted
      expect(mockStorage.delete).toHaveBeenCalledWith("storage123");

      // Verify all file records were deleted
      expect(mockDb.delete).toHaveBeenCalledWith("file1");
      expect(mockDb.delete).toHaveBeenCalledWith("file2");
      expect(mockDb.delete).toHaveBeenCalledWith("file3");

      // Verify success log
      expect(console.log).toHaveBeenCalledWith(
        "Scheduled deletion of 2 S3 objects for user user123",
      );
    });

    it("should handle only Convex files (no S3 files)", async () => {
      const { deleteAllUserData } = await import("../userDeletion");

      const mockScheduler = {
        runAfter: jest.fn(),
      };

      const mockDb = {
        query: jest.fn(),
        delete: jest.fn(),
      };

      const mockStorage = {
        delete: jest.fn(),
      };

      const mockAuth = {
        getUserIdentity: jest.fn().mockResolvedValue({
          subject: "user123",
        }),
      };

      const mockFiles = [
        {
          _id: "file1",
          storage_id: "storage123",
          user_id: "user123",
          name: "file1.txt",
          media_type: "text/plain",
          size: 500,
          file_token_size: 50,
          is_attached: true,
        },
      ];

      const mockQueryBuilder = {
        withIndex: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        collect: jest.fn(),
        take: jest.fn().mockResolvedValue([]),
        first: jest.fn(),
      };

      mockDb.query.mockReturnValue(mockQueryBuilder);

      mockQueryBuilder.collect
        .mockResolvedValueOnce([]) // chats
        .mockResolvedValueOnce(mockFiles) // files
        .mockResolvedValueOnce([]) // memories
        .mockResolvedValueOnce([]) // notes
        .mockResolvedValueOnce([]); // messages

      mockQueryBuilder.first.mockResolvedValue(null);

      const mockCtx = {
        auth: mockAuth,
        db: mockDb,
        storage: mockStorage,
        scheduler: mockScheduler,
      };

      await deleteAllUserData.handler(mockCtx, {});

      // Verify S3 batch deletion was NOT scheduled (no S3 files)
      expect(mockScheduler.runAfter).not.toHaveBeenCalled();

      // Verify Convex storage file was deleted
      expect(mockStorage.delete).toHaveBeenCalledWith("storage123");

      // Verify file record was deleted
      expect(mockDb.delete).toHaveBeenCalledWith("file1");
    });

    it("should handle only S3 files (no Convex files)", async () => {
      const { deleteAllUserData } = await import("../userDeletion");

      const mockScheduler = {
        runAfter: jest.fn(),
      };

      const mockDb = {
        query: jest.fn(),
        delete: jest.fn(),
      };

      const mockStorage = {
        delete: jest.fn(),
      };

      const mockAuth = {
        getUserIdentity: jest.fn().mockResolvedValue({
          subject: "user456",
        }),
      };

      const mockFiles = [
        {
          _id: "file1",
          s3_key: "users/user456/file1.pdf",
          user_id: "user456",
          name: "file1.pdf",
          media_type: "application/pdf",
          size: 1000,
          file_token_size: 100,
          is_attached: true,
        },
      ];

      const mockQueryBuilder = {
        withIndex: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        collect: jest.fn(),
        take: jest.fn().mockResolvedValue([]),
        first: jest.fn(),
      };

      mockDb.query.mockReturnValue(mockQueryBuilder);

      mockQueryBuilder.collect
        .mockResolvedValueOnce([]) // chats
        .mockResolvedValueOnce(mockFiles) // files
        .mockResolvedValueOnce([]) // memories
        .mockResolvedValueOnce([]) // notes
        .mockResolvedValueOnce([]); // messages

      mockQueryBuilder.first.mockResolvedValue(null);

      const mockCtx = {
        auth: mockAuth,
        db: mockDb,
        storage: mockStorage,
        scheduler: mockScheduler,
      };

      await deleteAllUserData.handler(mockCtx, {});

      // Verify S3 batch deletion was scheduled
      expect(mockScheduler.runAfter).toHaveBeenCalledWith(
        0,
        "deleteS3ObjectsBatchAction",
        { s3Keys: ["users/user456/file1.pdf"] },
      );

      // Verify Convex storage delete was NOT called
      expect(mockStorage.delete).not.toHaveBeenCalled();

      // Verify file record was deleted
      expect(mockDb.delete).toHaveBeenCalledWith("file1");
    });

    it("should not fail user deletion if S3 cleanup scheduling fails", async () => {
      const { deleteAllUserData } = await import("../userDeletion");

      const mockScheduler = {
        runAfter: jest.fn().mockRejectedValue(new Error("Scheduler error")),
      };

      const mockDb = {
        query: jest.fn(),
        delete: jest.fn(),
      };

      const mockStorage = {
        delete: jest.fn(),
      };

      const mockAuth = {
        getUserIdentity: jest.fn().mockResolvedValue({
          subject: "user789",
        }),
      };

      const mockFiles = [
        {
          _id: "file1",
          s3_key: "users/user789/file1.pdf",
          user_id: "user789",
          name: "file1.pdf",
          media_type: "application/pdf",
          size: 1000,
          file_token_size: 100,
          is_attached: true,
        },
      ];

      const mockQueryBuilder = {
        withIndex: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        collect: jest.fn(),
        take: jest.fn().mockResolvedValue([]),
        first: jest.fn(),
      };

      mockDb.query.mockReturnValue(mockQueryBuilder);

      mockQueryBuilder.collect
        .mockResolvedValueOnce([]) // chats
        .mockResolvedValueOnce(mockFiles) // files
        .mockResolvedValueOnce([]) // memories
        .mockResolvedValueOnce([]) // notes
        .mockResolvedValueOnce([]); // messages

      mockQueryBuilder.first.mockResolvedValue(null);

      const mockCtx = {
        auth: mockAuth,
        db: mockDb,
        storage: mockStorage,
        scheduler: mockScheduler,
      };

      // Should not throw even if S3 cleanup scheduling fails
      await expect(
        deleteAllUserData.handler(mockCtx, {}),
      ).resolves.not.toThrow();

      // Verify error was logged
      expect(console.error).toHaveBeenCalledWith(
        "Failed to schedule S3 batch deletion:",
        expect.any(Error),
      );

      // Verify file record was still deleted
      expect(mockDb.delete).toHaveBeenCalledWith("file1");
    });

    it("should handle Convex storage deletion errors gracefully", async () => {
      const { deleteAllUserData } = await import("../userDeletion");

      const mockScheduler = {
        runAfter: jest.fn(),
      };

      const mockDb = {
        query: jest.fn(),
        delete: jest.fn(),
      };

      const mockStorage = {
        delete: jest
          .fn()
          .mockRejectedValue(new Error("Storage deletion failed")),
      };

      const mockAuth = {
        getUserIdentity: jest.fn().mockResolvedValue({
          subject: "user999",
        }),
      };

      const mockFiles = [
        {
          _id: "file1",
          storage_id: "storage123",
          user_id: "user999",
          name: "file1.txt",
          media_type: "text/plain",
          size: 500,
          file_token_size: 50,
          is_attached: true,
        },
      ];

      const mockQueryBuilder = {
        withIndex: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        collect: jest.fn(),
        take: jest.fn().mockResolvedValue([]),
        first: jest.fn(),
      };

      mockDb.query.mockReturnValue(mockQueryBuilder);

      mockQueryBuilder.collect
        .mockResolvedValueOnce([]) // chats
        .mockResolvedValueOnce(mockFiles) // files
        .mockResolvedValueOnce([]) // memories
        .mockResolvedValueOnce([]) // notes
        .mockResolvedValueOnce([]); // messages

      mockQueryBuilder.first.mockResolvedValue(null);

      const mockCtx = {
        auth: mockAuth,
        db: mockDb,
        storage: mockStorage,
        scheduler: mockScheduler,
      };

      // Should not throw
      await expect(
        deleteAllUserData.handler(mockCtx, {}),
      ).resolves.not.toThrow();

      // Verify warning was logged
      expect(console.warn).toHaveBeenCalledWith(
        "Failed to delete storage blob:",
        "storage123",
        expect.any(Error),
      );

      // Verify file record was still deleted
      expect(mockDb.delete).toHaveBeenCalledWith("file1");
    });

    it("should handle empty file list", async () => {
      const { deleteAllUserData } = await import("../userDeletion");

      const mockScheduler = {
        runAfter: jest.fn(),
      };

      const mockDb = {
        query: jest.fn(),
        delete: jest.fn(),
      };

      const mockStorage = {
        delete: jest.fn(),
      };

      const mockAuth = {
        getUserIdentity: jest.fn().mockResolvedValue({
          subject: "user000",
        }),
      };

      const mockQueryBuilder = {
        withIndex: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        collect: jest.fn(),
        take: jest.fn().mockResolvedValue([]),
        first: jest.fn(),
      };

      mockDb.query.mockReturnValue(mockQueryBuilder);

      mockQueryBuilder.collect
        .mockResolvedValueOnce([]) // chats
        .mockResolvedValueOnce([]) // files - empty
        .mockResolvedValueOnce([]) // memories
        .mockResolvedValueOnce([]) // notes
        .mockResolvedValueOnce([]); // messages

      mockQueryBuilder.first.mockResolvedValue(null);

      const mockCtx = {
        auth: mockAuth,
        db: mockDb,
        storage: mockStorage,
        scheduler: mockScheduler,
      };

      await deleteAllUserData.handler(mockCtx, {});

      // Verify S3 batch deletion was NOT scheduled (no files)
      expect(mockScheduler.runAfter).not.toHaveBeenCalled();

      // Verify storage delete was NOT called
      expect(mockStorage.delete).not.toHaveBeenCalled();
    });

    it("deletes task runs, tasks, and projects in dependency order", async () => {
      const { deleteTasksAndProjectsBatch } = await import("../userDeletion");
      const rowsByTable: Record<string, Array<{ _id: string }>> = {
        task_runs: [{ _id: "run-1" }],
        tasks: [{ _id: "task-1" }],
        bot_meetings: [{ _id: "meeting-1" }],
        project_bots: [{ _id: "bot-1" }],
        projects: [{ _id: "project-1" }],
      };
      const queriedTables: string[] = [];
      const deleteOrder: string[] = [];
      const mockDb = {
        query: jest.fn((table: string) => {
          queriedTables.push(table);
          const range: any = {};
          range.eq = jest.fn(() => range);
          return {
            withIndex: jest.fn((_indexName: string, predicate: any) => {
              predicate(range);
              return {
                take: jest
                  .fn<any>()
                  .mockResolvedValue(rowsByTable[table] ?? []),
              };
            }),
          };
        }),
        delete: jest.fn(async (id: string) => {
          deleteOrder.push(id);
        }),
      };
      const mockCtx: any = {
        db: mockDb,
        scheduler: { runAfter: jest.fn() },
      };

      await expect(
        (deleteTasksAndProjectsBatch as any).handler(mockCtx, {
          userId: "user123",
        }),
      ).resolves.toBeNull();

      expect(queriedTables).toEqual([
        "task_runs",
        "tasks",
        "bot_meetings",
        "project_bots",
        "projects",
      ]);
      expect(deleteOrder).toEqual([
        "run-1",
        "task-1",
        "meeting-1",
        "bot-1",
        "project-1",
      ]);
      expect(mockCtx.scheduler.runAfter).not.toHaveBeenCalled();
    });

    it("caps each owned-record cleanup pass and schedules the next batch", async () => {
      const { deleteTasksAndProjectsBatch } = await import("../userDeletion");
      const taskRuns = Array.from({ length: 100 }, (_, index) => ({
        _id: `run-${index}`,
      }));
      const take = jest.fn<any>().mockResolvedValue(taskRuns);
      const mockDb = {
        query: jest.fn(() => ({
          withIndex: jest.fn((_indexName: string, predicate: any) => {
            const range: any = {};
            range.eq = jest.fn(() => range);
            predicate(range);
            return { take };
          }),
        })),
        delete: jest.fn<any>().mockResolvedValue(undefined),
      };
      const runAfter = jest.fn<any>().mockResolvedValue(undefined);
      const mockCtx: any = {
        db: mockDb,
        scheduler: { runAfter },
      };

      await (deleteTasksAndProjectsBatch as any).handler(mockCtx, {
        userId: "user123",
      });

      expect(take).toHaveBeenCalledWith(100);
      expect(mockDb.delete).toHaveBeenCalledTimes(100);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
      expect(runAfter).toHaveBeenCalledWith(0, "deleteTasksAndProjectsBatch", {
        userId: "user123",
      });
    });

    it("should throw error if user is not authenticated", async () => {
      const { deleteAllUserData } = await import("../userDeletion");

      const mockAuth = {
        getUserIdentity: jest.fn().mockResolvedValue(null),
      };

      const mockCtx = {
        auth: mockAuth,
      };

      await expect(deleteAllUserData.handler(mockCtx, {})).rejects.toThrow(
        "Unauthorized: User not authenticated",
      );
    });
  });
});
