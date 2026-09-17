/** @jest-environment node */
const mockCalls: Array<{ url: string; key: unknown; operation: string }> = [];
jest.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(readonly url: string) {
      if (!url.startsWith("https://")) throw new Error("Invalid fixture URL");
    }
    async mutation(operation: string, args: { serviceKey?: string }) {
      mockCalls.push({ url: this.url, key: args.serviceKey, operation });
      return null;
    }
  },
}));
jest.mock("@/convex/_generated/api", () => ({
  api: {
    runs: {
      startRun: "start",
      finishRun: "finish",
      markRunStatus: "status",
      appendRunEvent: "event",
      appendRunEvents: "events",
      recordEvidence: "evidence",
    },
  },
}));
import { withConvexClientScope } from "@/lib/db/convex-client-scope";
import type * as RecorderModule from "../run-recorder";
const savedKey = process.env.CONVEX_SERVICE_ROLE_KEY;
const savedUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const A = "https://recorder-a.convex.cloud",
  B = "https://recorder-b.convex.cloud";
let recorderModule: typeof RecorderModule;
const base = { runId: "run-A", chatId: "chat-A", userId: "owner-A" };
beforeAll(() => {
  // Import-time capture must only see a public fixture value, never real env.
  process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-import-key";
  recorderModule = require("../run-recorder");
});
beforeEach(() => {
  mockCalls.length = 0;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  if (savedKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = savedKey;
  if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
  else process.env.NEXT_PUBLIC_CONVEX_URL = savedUrl;
});
test("returned recorder methods and queued flush retain their originating client and key", async () => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-key-A";
  const recorder = withConvexClientScope(A, () =>
    recorderModule.createRunRecorder(base),
  );
  process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-key-B";
  await withConvexClientScope(B, async () => {
    await recorder.markStatus("running");
    await recorder.appendEvent({ type: "step" });
    recorder.queueEvent({ type: "tool" });
    await recorder.flush();
    await recorder.recordFinding({ title: "Fixture", severity: "info" });
  });
  expect(mockCalls).toEqual(
    ["status", "event", "events", "evidence"].map((operation) => ({
      url: A,
      key: "fixture-key-A",
      operation,
    })),
  );
});
test("recorder with missing key at creation cannot borrow a later key", async () => {
  delete process.env.CONVEX_SERVICE_ROLE_KEY;
  const recorder = withConvexClientScope(A, () =>
    recorderModule.createRunRecorder(base),
  );
  process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-key-B";
  await withConvexClientScope(B, () => recorder.appendEvent({ type: "step" }));
  expect(mockCalls).toEqual([{ url: A, key: "", operation: "event" }]);
});
test("recorder with invalid initial URL stays best-effort without writing to a later deployment", async () => {
  const recorder = withConvexClientScope("invalid-fixture", () =>
    recorderModule.createRunRecorder(base),
  );
  await withConvexClientScope(B, () => recorder.markStatus("running"));
  expect(mockCalls).toEqual([]);
  expect(console.warn).toHaveBeenCalledTimes(1);
});
test("start and finish use the active scope rather than import-time credentials", async () => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-key-A";
  await withConvexClientScope(A, async () => {
    process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-key-B";
    await recorderModule.startRunRecord(base);
    await recorderModule.finishRunRecord({
      runId: base.runId,
      status: "completed",
    });
  });
  expect(mockCalls).toEqual(
    ["start", "finish"].map((operation) => ({
      url: A,
      key: "fixture-key-A",
      operation,
    })),
  );
});
