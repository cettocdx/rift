/** @jest-environment node */
jest.mock("@trigger.dev/sdk", () => ({
  task: (config: unknown) => config,
  schedules: { task: (config: unknown) => config },
  retry: { onThrow: (run: () => unknown) => run() },
  metadata: { set: jest.fn().mockReturnThis() },
}));
jest.mock("../../../trigger/agent-long", () => ({
  agentLongTask: { trigger: jest.fn() },
}));
jest.mock("@/lib/db/actions", () => ({
  saveChat: jest.fn(),
  saveMessage: jest.fn(),
}));
jest.mock("@/lib/tasks/scheduled-task-backend", () => ({
  beginScheduledRun: jest.fn(),
  registerScheduledAgentRun: jest.fn(),
  finishScheduledRun: jest.fn(),
  claimDueScheduledRuns: jest.fn(),
  markScheduledRunDispatched: jest.fn(),
  releaseScheduledRunDispatch: jest.fn(),
}));
import {
  scheduledTaskWorker,
  scheduledTaskDispatcher,
} from "../../../trigger/scheduled-tasks";
import { agentLongTask } from "../../../trigger/agent-long";
import { saveChat, saveMessage } from "@/lib/db/actions";
import {
  beginScheduledRun,
  claimDueScheduledRuns,
  markScheduledRunDispatched,
  releaseScheduledRunDispatch,
  registerScheduledAgentRun,
  finishScheduledRun,
} from "../scheduled-task-backend";
const execute = () =>
  (scheduledTaskWorker as any).run(
    { executionKey: "run-occurrence" },
    { ctx: { run: { id: "worker-1" } } },
  );
beforeEach(() => {
  jest.clearAllMocks();
  (agentLongTask.trigger as jest.Mock).mockResolvedValue({ id: "agent-1" });
  (registerScheduledAgentRun as jest.Mock).mockResolvedValue({ success: true });
});

test("existing bot and meeting conversations are reused without overwriting their bindings", async () => {
  (beginScheduledRun as jest.Mock).mockResolvedValue({
    state: "ready",
    userId: "u1",
    title: "Release meeting",
    prompt: "Review release criteria",
    purpose: "app",
    subscription: "pro",
    chatId: "meeting-chat",
  });
  const result = await execute();
  expect(saveChat).not.toHaveBeenCalled();
  expect(saveMessage).toHaveBeenCalledWith(
    expect.objectContaining({ chatId: "meeting-chat", userId: "u1" }),
  );
  expect(agentLongTask.trigger).toHaveBeenCalledWith(
    expect.objectContaining({
      chatId: "meeting-chat",
      isNewChat: false,
      scheduledRun: { executionKey: "run-occurrence" },
    }),
    expect.objectContaining({
      idempotencyKey: "scheduled-agent:run-occurrence",
    }),
  );
  expect(registerScheduledAgentRun).toHaveBeenCalledWith(
    expect.objectContaining({ chatId: "meeting-chat", agentRunId: "agent-1" }),
  );
  expect(result).toMatchObject({ chatId: "meeting-chat", runId: "agent-1" });
});

test("a busy conversation is deferred with no message, model, or completion side effects", async () => {
  (beginScheduledRun as jest.Mock).mockResolvedValue({ state: "deferred" });
  expect(await execute()).toEqual({ state: "deferred" });
  expect(saveChat).not.toHaveBeenCalled();
  expect(saveMessage).not.toHaveBeenCalled();
  expect(agentLongTask.trigger).not.toHaveBeenCalled();
  expect(finishScheduledRun).not.toHaveBeenCalled();
});

test("ordinary scheduled tasks still create a deterministic chat and retain project context", async () => {
  (beginScheduledRun as jest.Mock).mockResolvedValue({
    state: "ready",
    userId: "u1",
    title: "Review",
    prompt: "Review this project",
    purpose: "app",
    subscription: "pro",
    projectId: "p1",
  });
  await execute();
  const first = (saveMessage as jest.Mock).mock.calls[0][0];
  await execute();
  expect((saveMessage as jest.Mock).mock.calls[1][0]).toEqual(first);
  expect(saveChat).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: "p1",
      userId: "u1",
      id: first.chatId,
    }),
  );
});

// Exercise the real worker entry and AsyncLocalStorage, stubbing only remote
// database/model I/O. These checks catch missing scopes around catch/dispatch.
import { getConvexUrl } from "@/lib/db/convex-client";
const defaultUrl = "https://default-task.convex.cloud";
const previewUrl = "https://preview-task.convex.cloud";
const nextUrl = "https://next-task.convex.cloud";
const priorUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
afterEach(() => {
  if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
  else process.env.NEXT_PUBLIC_CONVEX_URL = priorUrl;
});
const readySnapshot = {
  state: "ready",
  userId: "u1",
  title: "Review",
  prompt: "Review project",
  purpose: "app",
  subscription: "pro",
  chatId: "existing-chat",
};
test.each([previewUrl, undefined])(
  "worker captures and forwards its resolved deployment (%p)",
  async (convexUrl) => {
    process.env.NEXT_PUBLIC_CONVEX_URL = defaultUrl;
    const expected = convexUrl ?? defaultUrl;
    (beginScheduledRun as jest.Mock).mockImplementation(async () => {
      expect(getConvexUrl()).toBe(expected);
      process.env.NEXT_PUBLIC_CONVEX_URL = nextUrl;
      await Promise.resolve();
      return readySnapshot;
    });
    (saveMessage as jest.Mock).mockImplementation(async () => {
      expect(getConvexUrl()).toBe(expected);
    });
    (registerScheduledAgentRun as jest.Mock).mockImplementation(async () => {
      expect(getConvexUrl()).toBe(expected);
      return { success: true };
    });
    await (scheduledTaskWorker as any).run(
      { executionKey: "run-occurrence", convexUrl },
      { ctx: { run: { id: "worker-1" } } },
    );
    expect(agentLongTask.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ convexUrl: expected, userId: "u1" }),
      expect.anything(),
    );
    expect(getConvexUrl()).toBe(nextUrl);
  },
);

test("worker failure settlement stays on the failed task deployment", async () => {
  process.env.NEXT_PUBLIC_CONVEX_URL = defaultUrl;
  (beginScheduledRun as jest.Mock).mockImplementation(async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = nextUrl;
    throw new Error("snapshot unavailable");
  });
  (finishScheduledRun as jest.Mock).mockImplementation(async () => {
    expect(getConvexUrl()).toBe(previewUrl);
  });
  await expect(
    (scheduledTaskWorker as any).run(
      { executionKey: "run-occurrence", convexUrl: previewUrl },
      { ctx: { run: { id: "worker-1" } } },
    ),
  ).rejects.toThrow("snapshot unavailable");
  expect(finishScheduledRun).toHaveBeenCalledWith(
    expect.objectContaining({ status: "failed", workerRunId: "worker-1" }),
  );
  expect(getConvexUrl()).toBe(nextUrl);
});

test("dispatcher pins the default for reads, child dispatch and settlement", async () => {
  process.env.NEXT_PUBLIC_CONVEX_URL = defaultUrl;
  (claimDueScheduledRuns as jest.Mock).mockImplementation(async () => {
    expect(getConvexUrl()).toBe(defaultUrl);
    process.env.NEXT_PUBLIC_CONVEX_URL = nextUrl;
    return [{ executionKey: "due-occurrence", dispatchAttempt: 1 }];
  });
  (scheduledTaskWorker as any).trigger = jest
    .fn()
    .mockResolvedValue({ id: "child-1" });
  (markScheduledRunDispatched as jest.Mock).mockImplementation(async () => {
    expect(getConvexUrl()).toBe(defaultUrl);
    return { success: true };
  });
  expect(
    await (scheduledTaskDispatcher as any).run(
      {},
      { ctx: { run: { id: "dispatcher-1" } } },
    ),
  ).toEqual({ claimed: 1 });
  expect((scheduledTaskWorker as any).trigger).toHaveBeenCalledWith(
    expect.objectContaining({ convexUrl: defaultUrl }),
    expect.anything(),
  );
  expect(getConvexUrl()).toBe(nextUrl);
});

test("dispatcher dispatch failure releases its original deployment lease", async () => {
  process.env.NEXT_PUBLIC_CONVEX_URL = defaultUrl;
  (claimDueScheduledRuns as jest.Mock).mockResolvedValue([
    { executionKey: "due-occurrence", dispatchAttempt: 1 },
  ]);
  (scheduledTaskWorker as any).trigger = jest
    .fn()
    .mockImplementation(async () => {
      process.env.NEXT_PUBLIC_CONVEX_URL = nextUrl;
      throw new Error("dispatch unavailable");
    });
  (releaseScheduledRunDispatch as jest.Mock).mockImplementation(async () => {
    expect(getConvexUrl()).toBe(defaultUrl);
  });
  await expect(
    (scheduledTaskDispatcher as any).run(
      {},
      { ctx: { run: { id: "dispatcher-1" } } },
    ),
  ).rejects.toThrow("dispatches failed");
  expect(releaseScheduledRunDispatch).toHaveBeenCalledWith(
    expect.objectContaining({ leaseOwner: "dispatcher-1" }),
  );
});
