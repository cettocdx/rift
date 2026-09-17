/** @jest-environment node */
const mockQuery = jest.fn();
const mockReceipt = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery }),
  getConvexServiceKey: () => "service-fixture",
}));
jest.mock("@/lib/api/agent-dispatch-admission", () => ({
  agentDispatchAdmissionEnabled: () =>
    process.env.RIFT_DURABLE_DISPATCH_ADMISSION === "true",
  readAgentDispatchReceipt: (...args: unknown[]) => mockReceipt(...args),
}));
jest.mock("@/lib/suspensions", () => ({
  assertUserCanMakeCostIncurringRequest: jest.fn(async () => {}),
}));

import {
  createHackRunBinding,
  hashHackRunPayload,
  assertHackRunPayload,
  assertHackRunMessage,
  authorizeHackWorkerRun,
} from "../durable-run";

const request = {
  id: "request-1",
  role: "user" as const,
  parts: [
    { type: "text" as const, text: "Inspect saved evidence for example.test" },
  ],
};
const payload = () => ({
  userId: "owner",
  chatId: "chat-1",
  startClaimId: "claim-1",
  dispatchId: request.id,
  purpose: "security",
  temporary: false,
  approvalMode: "ask",
  sandboxPreference: "e2b",
  selectedModel: "build-grok",
  baseTodos: [],
  userLocation: {},
  hackRun: createHackRunBinding(request, " example.test "),
});

beforeEach(() => {
  process.env.RIFT_DURABLE_HACK_ENABLED = "true";
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
  mockQuery.mockResolvedValue(["ultra-monthly-plan"]);
  mockReceipt.mockImplementation(async () => ({
    dispatchId: request.id,
    requestMessageId: request.id,
    claimId: "claim-1",
    state: "dispatching",
    requiresCleanup: true,
    fingerprintVersion: 1,
    payloadHash: hashHackRunPayload(payload()),
  }));
});
afterEach(() => {
  delete process.env.RIFT_DURABLE_HACK_ENABLED;
  delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  jest.clearAllMocks();
});

it("authorizes only a live Max owner with a matching server-owned dispatch fingerprint", async () => {
  await expect(
    authorizeHackWorkerRun(payload(), "run-1"),
  ).resolves.toMatchObject({
    scope: "example.test",
    requestMessageId: request.id,
  });
  expect(mockReceipt).toHaveBeenCalledWith({
    userId: "owner",
    chatId: "chat-1",
    dispatchId: request.id,
  });
});
it("rejects execution without the trusted cleanup fence regardless of client flags", async () => {
  const receipt = await mockReceipt();
  delete receipt.requiresCleanup;
  mockReceipt.mockResolvedValue(receipt);
  await expect(
    authorizeHackWorkerRun({ ...payload(), requiresCleanup: true }, "run-1"),
  ).rejects.toThrow();
});

it.each([
  "scope",
  "request",
  "model",
  "approval",
  "claim",
  "dispatch",
  "project",
])(
  "rejects changed %s identity without accepting a client capability flag",
  async (field) => {
    const changed = payload();
    const originalHash = hashHackRunPayload(changed);
    mockReceipt.mockResolvedValue({
      dispatchId: request.id,
      requestMessageId: request.id,
      claimId: "claim-1",
      state: "dispatching",
      fingerprintVersion: 1,
      payloadHash: originalHash,
    });
    if (field === "scope") changed.hackRun.scope = "unrelated.test";
    if (field === "request") changed.hackRun.requestHash = "b".repeat(64);
    if (field === "model") changed.selectedModel = "build-codex";
    if (field === "approval") changed.approvalMode = "full";
    if (field === "claim") changed.startClaimId = "other-claim";
    if (field === "dispatch") changed.dispatchId = "other-request";
    if (field === "project")
      Object.assign(changed, {
        projectId: "other-project",
        hackAuthorized: true,
      });
    await expect(authorizeHackWorkerRun(changed, "run-1")).rejects.toThrow();
  },
);

it.each([
  "disabled",
  "no-admission",
  "downgraded",
  "outage",
  "missing-receipt",
  "other-run",
  "terminal",
])("fails closed for %s", async (condition) => {
  if (condition === "disabled") delete process.env.RIFT_DURABLE_HACK_ENABLED;
  if (condition === "no-admission")
    delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  if (condition === "downgraded")
    mockQuery.mockResolvedValue(["pro-monthly-plan"]);
  if (condition === "outage")
    mockQuery.mockRejectedValue(new Error("Entitlements unavailable"));
  if (condition === "missing-receipt") mockReceipt.mockResolvedValue(null);
  if (condition === "other-run" || condition === "terminal")
    mockReceipt.mockResolvedValue({
      dispatchId: request.id,
      requestMessageId: request.id,
      claimId: "claim-1",
      state: condition === "terminal" ? "terminal" : "accepted",
      runId: condition === "other-run" ? "other-run" : "run-1",
      fingerprintVersion: 1,
      payloadHash: hashHackRunPayload(payload()),
    });
  await expect(authorizeHackWorkerRun(payload(), "run-1")).rejects.toThrow();
});

it.each([
  { temporary: true },
  { isAutoContinue: true },
  { regenerate: true },
  { scheduledRun: {} },
  { purpose: "app" },
  { sandboxPreference: "desktop" },
  { workingFile: {} },
])("rejects unsupported execution envelope %j", (change) => {
  expect(() => assertHackRunPayload({ ...payload(), ...change })).toThrow();
});

it("binds the saved user turn and ignores expiring file URLs only when stable file ownership references exist", () => {
  const original = {
    ...request,
    parts: [
      {
        type: "file" as const,
        fileId: "file-1",
        filename: "evidence.txt",
        mediaType: "text/plain",
        url: "https://storage.test/old",
      },
    ],
  };
  const binding = createHackRunBinding(original, "example.test");
  expect(() =>
    assertHackRunMessage(binding, {
      ...original,
      parts: [{ ...original.parts[0], url: "https://storage.test/refreshed" }],
    }),
  ).not.toThrow();
  expect(() => assertHackRunMessage(binding, request)).toThrow();
  expect(() =>
    createHackRunBinding({ ...request, role: "assistant" }, "example.test"),
  ).toThrow();
});

it("pins the worker to its configured deployment before any remote authorization read", async () => {
  const helper = jest.requireActual("../durable-run") as {
    resolveHackWorkerConvexUrl?: (url: unknown) => string;
  };
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://trusted.convex.cloud";
  try {
    expect(helper.resolveHackWorkerConvexUrl).toBeDefined();
    expect(() =>
      helper.resolveHackWorkerConvexUrl!("https://attacker.convex.cloud"),
    ).toThrow();
    expect(
      helper.resolveHackWorkerConvexUrl!("https://trusted.convex.cloud"),
    ).toBe("https://trusted.convex.cloud");
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    expect(() =>
      helper.resolveHackWorkerConvexUrl!("https://trusted.convex.cloud"),
    ).toThrow();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockReceipt).not.toHaveBeenCalled();
  } finally {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  }
});

it.each([
  { temporary: "true" },
  { isAutoContinue: "true" },
  { regenerate: "true" },
  { localDesktopAttachmentsPrepared: "true" },
  { messages: [request] },
])("rejects a tampered execution payload %j", (change) => {
  expect(() => assertHackRunPayload({ ...payload(), ...change })).toThrow();
});
