/** @jest-environment node */
import { withConvexClientScope } from "@/lib/db/convex-client-scope";
import { uploadSandboxFileToConvex } from "../sandbox-file-uploader";

const mockActions: Array<{ url: string; args: Record<string, unknown> }> = [];
jest.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(private url: string) {}
    async action(_reference: unknown, args: Record<string, unknown>) {
      mockActions.push({ url: this.url, args });
      return "fileName" in args
        ? {
            backend: "s3",
            uploadUrl: "https://upload.example/file",
            s3Key: "user/report.txt",
          }
        : { url: "https://download.example/file", fileId: "file-a", tokens: 0 };
    }
  },
}));

const keys = ["NEXT_PUBLIC_CONVEX_URL", "CONVEX_SERVICE_ROLE_KEY"] as const;
const original = keys.map((key) => process.env[key]);
function environment(url?: string, key?: string) {
  for (const [name, value] of [
    [keys[0], url],
    [keys[1], key],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
function sandbox(onStat = async () => {}, onUpload = async () => {}) {
  return {
    sandboxKind: "centrifugo",
    commands: {
      run: jest.fn(async () => {
        await onStat();
        return { stdout: "12", stderr: "", exitCode: 0 };
      }),
    },
    files: { uploadToUrl: jest.fn(onUpload) },
  };
}
function upload(target: ReturnType<typeof sandbox>) {
  return uploadSandboxFileToConvex({
    sandbox: target as any,
    userId: "user-a",
    fullPath: "/home/user/report.txt",
  });
}
beforeEach(() => {
  mockActions.length = 0;
});
afterEach(() => {
  environment(original[0], original[1]);
});

it("uses a captured worker URL even when the process URL has since disappeared", async () => {
  environment("https://upload-a.convex.cloud", "key-a");
  await withConvexClientScope(undefined, async () => {
    environment(undefined, "key-b");
    await upload(sandbox());
  });
  expect(mockActions).toHaveLength(2);
  for (const call of mockActions) {
    expect(call.url).toBe("https://upload-a.convex.cloud");
    expect(call.args.serviceKey).toBe("key-a");
  }
});

it("rejects a missing originating URL before touching sandbox files", async () => {
  environment(undefined, "key-a");
  const target = sandbox();
  await withConvexClientScope(undefined, async () => {
    environment("https://upload-b.convex.cloud", "key-b");
    await expect(upload(target)).rejects.toThrow(/NEXT_PUBLIC_CONVEX_URL/);
  });
  expect(target.commands.run).not.toHaveBeenCalled();
  expect(target.files.uploadToUrl).not.toHaveBeenCalled();
  expect(mockActions).toEqual([]);
});

it("copies unscoped upload authority before the asynchronous file preflight", async () => {
  environment("https://upload-a.convex.cloud", "key-a");
  await upload(
    sandbox(async () => {
      environment("https://upload-b.convex.cloud", "key-b");
    }),
  );
  expect(mockActions).toHaveLength(2);
  for (const call of mockActions) {
    expect(call.url).toBe("https://upload-a.convex.cloud");
    expect(call.args.serviceKey).toBe("key-a");
  }
});

it("uses the same authority to save metadata after the byte upload", async () => {
  environment("https://upload-a.convex.cloud", "key-a");
  await upload(
    sandbox(undefined, async () => {
      environment("https://upload-b.convex.cloud", "key-b");
    }),
  );
  expect(mockActions).toHaveLength(2);
  for (const call of mockActions) {
    expect(call.url).toBe("https://upload-a.convex.cloud");
    expect(call.args.serviceKey).toBe("key-a");
  }
});

it("does not borrow a later key when the originating scope lacks one", async () => {
  environment("https://upload-a.convex.cloud");
  const target = sandbox();
  await withConvexClientScope(undefined, async () => {
    environment("https://upload-b.convex.cloud", "key-b");
    await expect(upload(target)).rejects.toThrow(/CONVEX_SERVICE_ROLE_KEY/);
  });
  expect(target.commands.run).not.toHaveBeenCalled();
  expect(mockActions).toEqual([]);
});
