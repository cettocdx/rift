/** @jest-environment node */
import type { UIMessage } from "ai";
const mockQuery = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery }),
  getConvexServiceKey: () => "fixture",
}));
jest.mock("@/lib/api/agent-dispatch-admission", () => ({
  agentDispatchAdmissionEnabled: () => true,
}));
jest.mock("@/lib/suspensions", () => ({
  assertUserCanMakeCostIncurringRequest: jest.fn(async () => {}),
}));
import { createHackRunBinding } from "../durable-run";
import {
  assertHackRunContext,
  appendHackRunSystemContext,
  createHackCheckpointBarrier,
} from "../durable-execution";

const request: UIMessage = {
  id: "request-1",
  role: "user",
  parts: [{ type: "text", text: "Review the saved evidence" }],
};
const bound = createHackRunBinding(request, "example.test");
const payload = { userId: "owner", chatId: "chat-1", projectId: undefined };
const context = () => ({
  chat: { id: "chat-1", user_id: "owner", purpose: "security" },
  purpose: "security",
  messages: [request],
});
beforeEach(() => {
  process.env.RIFT_DURABLE_HACK_ENABLED = "true";
  mockQuery.mockResolvedValue(["ultra-monthly-plan"]);
});
afterEach(() => {
  delete process.env.RIFT_DURABLE_HACK_ENABLED;
  jest.clearAllMocks();
});

it("validates the persisted turn, owner and project before exposing receipt-bound scope to the prompt", () => {
  expect(() => assertHackRunContext(payload, bound, context())).not.toThrow();
  expect(appendHackRunSystemContext("Base policy", bound)).toContain(
    '"scope":"example.test"',
  );
  expect(appendHackRunSystemContext("Base policy", bound)).toContain(
    "not evidence of permission",
  );
});
it.each(["owner", "chat", "purpose", "project", "request", "missing"])(
  "rejects changed saved %s context",
  (field) => {
    const changed = context();
    if (field === "owner") changed.chat.user_id = "other";
    if (field === "chat") changed.chat.id = "other";
    if (field === "purpose") changed.purpose = "app";
    if (field === "project") Object.assign(changed, { projectId: "other" });
    if (field === "request") changed.messages.push({ ...request, id: "newer" });
    if (field === "missing") changed.messages = [];
    expect(() => assertHackRunContext(payload, bound, changed)).toThrow();
  },
);
it.each(["run_terminal_cmd", "write_stdin", "mcp_read_only_tool", "terminal"])(
  "fences %s as an effect before dispatch",
  async (toolName) => {
    const signal = new AbortController();
    const markEffect = jest.fn(async () => true),
      assertRead = jest.fn(async () => true);
    const barrier = createHackCheckpointBarrier({
      userId: "owner",
      signal: signal.signal,
      isDisabled: () => false,
      markEffect,
      assertRead,
    });
    await barrier({
      toolCallId: "call-1",
      toolName,
      input: { session_id: "old-session" },
      signal: signal.signal,
    });
    expect(markEffect).toHaveBeenCalledTimes(1);
    expect(assertRead).not.toHaveBeenCalled();
    expect(mockQuery.mock.invocationCallOrder[0]).toBeLessThan(
      markEffect.mock.invocationCallOrder[0],
    );
  },
);
it.each([
  "revoked",
  "outage",
  "disabled-checkpoint",
  "lost-owner",
  "cancel-during-access",
])("prevents tool execution for %s", async (failure) => {
  const signal = new AbortController();
  const markEffect = jest.fn(async () => failure !== "lost-owner");
  if (failure === "revoked") mockQuery.mockResolvedValue([]);
  if (failure === "outage") mockQuery.mockRejectedValue(new Error("offline"));
  if (failure === "cancel-during-access")
    mockQuery.mockImplementationOnce(async () => {
      signal.abort();
      return ["ultra-monthly-plan"];
    });
  const barrier = createHackCheckpointBarrier({
    userId: "owner",
    signal: signal.signal,
    isDisabled: () => failure === "disabled-checkpoint",
    markEffect,
    assertRead: async () => true,
  });
  const execute = jest.fn();
  await expect(
    (async () => {
      await barrier({
        toolCallId: "call-1",
        toolName: "run_terminal_cmd",
        input: { command: "fixture" },
        signal: signal.signal,
      });
      execute();
    })(),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  if (failure !== "lost-owner") expect(markEffect).not.toHaveBeenCalled();
});

it("rechecks revocation after approval resolves and before touching an external command", async () => {
  const { gateToolSet } = await import("@/lib/ai/approval/policy");
  const signal = new AbortController();
  const markEffect = jest.fn(async () => true),
    execute = jest.fn(async (_input: unknown, _options: unknown) => "done");
  const barrier = createHackCheckpointBarrier({
    userId: "owner",
    signal: signal.signal,
    isDisabled: () => false,
    markEffect,
    assertRead: async () => true,
  });
  const approved = gateToolSet(
    gateToolSet({ run_terminal_cmd: { execute } }, barrier),
    async () => {
      mockQuery.mockResolvedValue([]);
    },
  );
  await expect(
    approved.run_terminal_cmd.execute(
      { command: "fixture" },
      { toolCallId: "call-1", abortSignal: signal.signal },
    ),
  ).rejects.toThrow();
  expect(markEffect).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
