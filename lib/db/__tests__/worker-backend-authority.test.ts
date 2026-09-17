/** @jest-environment node */
const mockCalls: Array<{ url: string; key: unknown; operation: string }> = [];
jest.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(readonly url: string) {}
    async query(operation: string, args: { serviceKey?: string }) {
      mockCalls.push({ url: this.url, key: args.serviceKey, operation });
      return null;
    }
    async mutation(operation: string, args: { serviceKey?: string }) {
      return this.query(operation, args);
    }
  },
}));
jest.mock("@/convex/_generated/api", () => ({
  api: {
    tasks: { beginScheduledRunForBackend: "begin" },
    userSuspensions: { getActiveByUser: "suspension" },
  },
}));
import { getConvexServiceKey } from "../convex-client";
import {
  withConvexClientScope,
  bindConvexClientScope,
} from "../convex-client-scope";
const savedKey = process.env.CONVEX_SERVICE_ROLE_KEY;
let beginScheduledRun: typeof import("@/lib/tasks/scheduled-task-backend").beginScheduledRun;
let getActiveSuspensionForUser: typeof import("@/lib/suspensions").getActiveSuspensionForUser;
const A = "https://backend-a.convex.cloud",
  B = "https://backend-b.convex.cloud";
beforeAll(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-import-key";
  ({ beginScheduledRun } = require("@/lib/tasks/scheduled-task-backend"));
  ({ getActiveSuspensionForUser } = require("@/lib/suspensions"));
});
afterEach(() => {
  mockCalls.length = 0;
  if (savedKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = savedKey;
});
test("scheduled run and suspension checks retain captured authority after an await", async () => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-key-A";
  await withConvexClientScope(A, async () => {
    process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-key-B";
    await Promise.resolve();
    await beginScheduledRun({
      executionKey: "schedule-A",
      workerRunId: "run-A",
      now: 1,
    });
    await getActiveSuspensionForUser("owner-A");
  });
  expect(mockCalls).toEqual(
    ["begin", "suspension"].map((operation) => ({
      url: A,
      key: "fixture-key-A",
      operation,
    })),
  );
});
test("bound cancellation captures its authority and restores the caller's scope", () => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-key-A";
  const cleanup = withConvexClientScope(A, () =>
    bindConvexClientScope(getConvexServiceKey),
  );
  process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-key-B";
  withConvexClientScope(B, () => {
    expect(cleanup()).toBe("fixture-key-A");
    expect(getConvexServiceKey()).toBe("fixture-key-B");
  });
});
test("unscoped calls read current authority without reviving an old run", () => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "fixture-key-A";
  expect(getConvexServiceKey()).toBe("fixture-key-A");
  delete process.env.CONVEX_SERVICE_ROLE_KEY;
  expect(getConvexServiceKey()).toBeUndefined();
});
