jest.mock("server-only", () => ({}), { virtual: true });

jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: jest.fn(),
}));

import { getConvexClient } from "@/lib/db/convex-client";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_GENERATED_FILE_SIZE_BYTES,
} from "@/lib/constants/s3";
import { uploadSandboxFileToConvex } from "../sandbox-file-uploader";

const mockGetConvexClient = getConvexClient as jest.MockedFunction<
  typeof getConvexClient
>;
let mockConvexAction: jest.Mock;
let uploadUrlResult: Record<string, unknown>;
let consoleWarnSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;

function makeSandbox(size: number, e2b = false) {
  return {
    ...(e2b ? {} : { sandboxKind: "centrifugo" as const }),
    commands: {
      run: jest.fn(async (command: string) => {
        if (command.startsWith("stat ")) {
          return { stdout: String(size), stderr: "", exitCode: 0 };
        }
        if (command.includes("curl -fsSL -X PUT")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        // Convex storage answers a POST with the id of the stored blob.
        if (command.includes("curl -fsSL -X POST")) {
          return {
            stdout: '{"storageId":"kg2abc123"}',
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "unexpected command", exitCode: 1 };
      }),
    },
    files: {
      uploadToUrl: jest.fn(async () => undefined),
    },
    downloadUrl: jest.fn(async () => "https://sandbox.example/file"),
  };
}

describe("uploadSandboxFileToConvex", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://convex.example";
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-key";
    // The upload URL now comes from an action so this path gets the same
    // S3-or-Convex-storage fallback as every other upload.
    uploadUrlResult = {
      backend: "s3",
      uploadUrl: "https://s3.example/upload",
      s3Key: "users/u1/file.txt",
    };
    // Convex's generated `api` is a proxy that hands back a fresh object per
    // access, so the two actions are told apart by their arguments rather than
    // by reference identity.
    mockConvexAction = jest.fn(async (_reference: unknown, args: any) => {
      if (args && "fileName" in args) return uploadUrlResult;
      return {
        url: "https://s3.example/download",
        fileId: "file_123",
        tokens: 0,
      };
    });
    mockGetConvexClient.mockReturnValue({
      action: mockConvexAction,
    } as any);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test("rejects oversized Centrifugo files before uploading to S3", async () => {
    const sandbox = makeSandbox(MAX_GENERATED_FILE_SIZE_BYTES + 1);

    await expect(
      uploadSandboxFileToConvex({
        sandbox: sandbox as any,
        userId: "u1",
        fullPath: "/home/user/large.tar.gz",
      }),
    ).rejects.toThrow(/exceeds the maximum generated file size limit/);

    expect(sandbox.files.uploadToUrl).not.toHaveBeenCalled();
    expect(mockConvexAction).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"sandbox_generated_file_too_large"'),
    );
  });

  test("rejects oversized E2B files before uploading to S3", async () => {
    const sandbox = makeSandbox(MAX_GENERATED_FILE_SIZE_BYTES + 1, true);

    await expect(
      uploadSandboxFileToConvex({
        sandbox: sandbox as any,
        userId: "u1",
        fullPath: "/home/user/large.tar.gz",
      }),
    ).rejects.toThrow(/exceeds the maximum generated file size limit/);

    expect(sandbox.commands.run).toHaveBeenCalledTimes(1);
    expect(sandbox.downloadUrl).not.toHaveBeenCalled();
    expect(mockConvexAction).not.toHaveBeenCalled();
  });

  test("allows generated artifacts above the user upload limit", async () => {
    const sandbox = makeSandbox(MAX_FILE_SIZE_BYTES + 1);

    await uploadSandboxFileToConvex({
      sandbox: sandbox as any,
      userId: "u1",
      fullPath: "/home/user/archive.tar.gz",
    });

    expect(sandbox.files.uploadToUrl).toHaveBeenCalled();
    expect(mockConvexAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "archive.tar.gz",
        size: MAX_FILE_SIZE_BYTES + 1,
      }),
    );
  });

  test("uploads allowed Centrifugo files using the preflight size", async () => {
    const sandbox = makeSandbox(1234);

    const saved = await uploadSandboxFileToConvex({
      sandbox: sandbox as any,
      userId: "u1",
      fullPath: "/home/user/report.txt",
    });

    expect(sandbox.files.uploadToUrl).toHaveBeenCalledWith(
      "/home/user/report.txt",
      "https://s3.example/upload",
      "application/octet-stream",
    );
    expect(mockConvexAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "report.txt",
        size: 1234,
        s3Key: "users/u1/file.txt",
      }),
    );
    expect(saved).toMatchObject({
      name: "report.txt",
      s3Key: "users/u1/file.txt",
    });
  });

  test("falls back to command upload when native Centrifugo upload fails", async () => {
    const sandbox = makeSandbox(1234);
    sandbox.files.uploadToUrl.mockRejectedValueOnce(new Error("exit status 1"));

    await uploadSandboxFileToConvex({
      sandbox: sandbox as any,
      userId: "u1",
      fullPath: "/home/user/preview.png",
      mediaType: "image/png",
    });

    expect(sandbox.files.uploadToUrl).toHaveBeenCalledWith(
      "/home/user/preview.png",
      "https://s3.example/upload",
      "image/png",
    );
    expect(sandbox.commands.run).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("curl -fsSL -X PUT -H 'Content-Type: image/png'"),
      expect.objectContaining({
        timeoutMs: expect.any(Number),
      }),
    );
    expect(mockConvexAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "preview.png",
        size: 1234,
      }),
    );
  });

  test("reports command upload stderr instead of a bare exit status", async () => {
    const sandbox = makeSandbox(1234, true);
    (sandbox.commands.run as jest.Mock).mockImplementation(
      async (command: string) => {
        if (command.startsWith("stat ")) {
          return { stdout: "1234", stderr: "", exitCode: 0 };
        }
        if (command.includes("curl -fsSL -X PUT")) {
          return {
            stdout: "\n__RIFT_UPLOAD_EXIT_CODE__:56\n",
            stderr: "curl: (56) response ended early",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "unexpected command", exitCode: 1 };
      },
    );

    await expect(
      uploadSandboxFileToConvex({
        sandbox: sandbox as any,
        userId: "u1",
        fullPath: "/home/user/chart-page-1.png",
        mediaType: "image/png",
      }),
    ).rejects.toThrow(/curl: \(56\) response ended early/);
  });

  test("derives the file name from Windows-style paths", async () => {
    const sandbox = makeSandbox(1234);

    await uploadSandboxFileToConvex({
      sandbox: sandbox as any,
      userId: "u1",
      fullPath: "C:\\Users\\user\\report.txt",
    });

    expect(mockConvexAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fileName: "report.txt",
        contentType: "application/octet-stream",
        userId: "u1",
        size: 1234,
      }),
    );
    expect(mockConvexAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "report.txt",
      }),
    );
  });

  test("uploads to Convex storage when S3 is not configured", async () => {
    // S3 is optional product-wide: without credentials, uploads fall back to
    // Convex's own storage. This path used to call the raw S3 helper directly
    // and threw instead, so `file` view previews failed outright on a
    // deployment that never configured AWS.
    uploadUrlResult = {
      backend: "convex",
      uploadUrl: "https://convex.example/upload",
    };
    const sandbox = makeSandbox(2048);

    const result = await uploadSandboxFileToConvex({
      sandbox: sandbox as any,
      userId: "u1",
      fullPath: "/home/user/screenshot.png",
      mediaType: "image/png",
    });

    // Posted, not put: Convex storage answers with the handle to the blob.
    const uploadCall = sandbox.commands.run.mock.calls
      .map(([command]: [string]) => command)
      .find((command: string) => command.includes("curl"));
    expect(uploadCall).toContain("-X POST");

    // The metadata save carries the storage id, never a fabricated S3 key.
    const saveArgs = mockConvexAction.mock.calls
      .map(([, args]: [unknown, any]) => args)
      .find((args: any) => args && "name" in args && !("fileName" in args));
    expect(saveArgs).toMatchObject({
      storageId: "kg2abc123",
      name: "screenshot.png",
    });
    expect(saveArgs.s3Key).toBeUndefined();
    expect(result.storageId).toBe("kg2abc123");
  });

  test("fails loudly when Convex storage returns no storage id", async () => {
    // Without the id the bytes are stored but unreferenced. Silently
    // succeeding would leave a file nothing can ever open.
    uploadUrlResult = {
      backend: "convex",
      uploadUrl: "https://convex.example/upload",
    };
    const sandbox = makeSandbox(2048);
    sandbox.commands.run = jest.fn(async (command: string) => {
      if (command.startsWith("stat ")) {
        return { stdout: "2048", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }) as any;

    await expect(
      uploadSandboxFileToConvex({
        sandbox: sandbox as any,
        userId: "u1",
        fullPath: "/home/user/screenshot.png",
        mediaType: "image/png",
      }),
    ).rejects.toThrow(/no storage id/);
  });

  test("does not use the sandbox native uploader for Convex storage", async () => {
    // The native helper does a PUT and discards the response body, which for
    // Convex is the only handle to the stored blob.
    uploadUrlResult = {
      backend: "convex",
      uploadUrl: "https://convex.example/upload",
    };
    const sandbox = makeSandbox(2048);

    await uploadSandboxFileToConvex({
      sandbox: sandbox as any,
      userId: "u1",
      fullPath: "/home/user/a.png",
      mediaType: "image/png",
    });

    expect(sandbox.files.uploadToUrl).not.toHaveBeenCalled();
  });

  test("uploads allowed E2B files from the sandbox without downloading into memory", async () => {
    const sandbox = makeSandbox(4321, true);

    await uploadSandboxFileToConvex({
      sandbox: sandbox as any,
      userId: "u1",
      fullPath: "/home/user/archive.tar.gz",
    });

    expect(sandbox.downloadUrl).not.toHaveBeenCalled();
    expect(sandbox.files.uploadToUrl).not.toHaveBeenCalled();
    expect(sandbox.commands.run).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "curl -fsSL -X PUT -H 'Content-Type: application/octet-stream'",
      ),
      expect.objectContaining({
        timeoutMs: expect.any(Number),
      }),
    );
    const uploadCommand = (sandbox.commands.run as jest.Mock).mock.calls[1][0];
    expect(uploadCommand).toContain("'https://s3.example/upload'");
    expect(uploadCommand).not.toContain("UPLOAD_URL");
    expect(mockConvexAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "archive.tar.gz",
        size: 4321,
      }),
    );
  });
});
