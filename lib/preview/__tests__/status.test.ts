/** @jest-environment node */
const mockInfo = jest.fn(),
  mockConnect = jest.fn(),
  mockRun = jest.fn(),
  mockHost = jest.fn();
const mockCreate = jest.fn(),
  mockKill = jest.fn();
jest.mock("@e2b/code-interpreter", () => ({
  NotFoundError: class NotFoundError extends Error {},
  Sandbox: {
    getInfo: (...args: unknown[]) => mockInfo(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    kill: (...args: unknown[]) => mockKill(...args),
  },
}));
jest.mock("@/lib/ai/sandbox-context", () => ({
  getSandboxContext: () => ({
    connection: { domain: "e2b.app", apiKey: "key" },
  }),
}));
import { NotFoundError } from "@e2b/code-interpreter";
import { inspectSavedPreview, persistedSandboxId } from "../status";
const preview = { url: "https://3000-saved-id.e2b.app", port: 3000 };
beforeEach(() => {
  jest.clearAllMocks();
  mockInfo.mockResolvedValue({
    sandboxId: "saved-id",
    state: "running",
    metadata: { userID: "namespace" },
  });
  mockConnect.mockResolvedValue({
    getHost: mockHost,
    commands: { run: mockRun },
  });
  mockHost.mockReturnValue("3000-saved-id.e2b.app");
  mockRun.mockResolvedValue({ stdout: "RIFT_PREVIEW:0:200" });
});
afterEach(() => {
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockKill).not.toHaveBeenCalled();
});
it("checks exactly the saved owner-bound sandbox and probes only its saved localhost port", async () => {
  expect(await inspectSavedPreview(preview, "namespace")).toEqual({
    status: "running",
    url: preview.url,
  });
  expect(mockInfo).toHaveBeenCalledWith(
    "saved-id",
    expect.objectContaining({ requestTimeoutMs: 5000 }),
  );
  expect(mockConnect).toHaveBeenCalledWith("saved-id", expect.anything());
  expect(mockRun).toHaveBeenCalledWith(
    expect.stringContaining("http://127.0.0.1:3000/"),
    { timeoutMs: 5000 },
  );
});
it("rejects foreign namespace before connecting", async () => {
  expect(await inspectSavedPreview(preview, "foreign")).toEqual({
    status: "unavailable",
  });
  expect(mockConnect).not.toHaveBeenCalled();
});
it("leaves paused sandboxes paused", async () => {
  mockInfo.mockResolvedValue({
    sandboxId: "saved-id",
    state: "paused",
    metadata: { userID: "namespace" },
  });
  expect(await inspectSavedPreview(preview, "namespace")).toEqual({
    status: "paused",
  });
  expect(mockConnect).not.toHaveBeenCalled();
});
it.each(["lookup", "connect"])(
  "reports confirmed absence at %s without replacement",
  async (stage) => {
    (stage === "lookup" ? mockInfo : mockConnect).mockRejectedValue(
      new NotFoundError("gone"),
    );
    expect(await inspectSavedPreview(preview, "namespace")).toEqual({
      status: "missing",
    });
  },
);
it.each([
  "rate limit",
  "not found in upstream gateway",
  "timeout",
  "authentication",
])("keeps %s uncertain", async (message) => {
  mockInfo.mockRejectedValue(new Error(message));
  expect(await inspectSavedPreview(preview, "namespace")).toEqual({
    status: "transient",
  });
});
it.each([
  ["RIFT_PREVIEW:7:000", "stopped"],
  ["RIFT_PREVIEW:28:000", "transient"],
  ["RIFT_PREVIEW:0:503", "unavailable"],
  ["provider error page", "transient"],
])("classifies probe %s as %s", async (stdout, status) => {
  mockRun.mockResolvedValue({ stdout });
  expect(await inspectSavedPreview(preview, "namespace")).toEqual({ status });
});
it("rejects changed SDK URL before probing", async () => {
  mockHost.mockReturnValue("3000-replacement.e2b.app");
  expect(await inspectSavedPreview(preview, "namespace")).toEqual({
    status: "stale",
  });
  expect(mockRun).not.toHaveBeenCalled();
});
it.each([
  "http://3000-saved-id.e2b.app",
  "https://3000-saved-id.e2b.app/x",
  "https://user@3000-saved-id.e2b.app",
  "https://4000-saved-id.e2b.app",
])("rejects unsafe or mismatched persisted URL %s", async (url) => {
  expect(persistedSandboxId({ ...preview, url }, "e2b.app")).toBeNull();
  expect(await inspectSavedPreview({ ...preview, url }, "namespace")).toEqual({
    status: "unavailable",
  });
  expect(mockInfo).not.toHaveBeenCalled();
});

it.each(["http://localhost:3000", "https://preview.example.org"])(
  "returns unsupported for non-cloud preview %s without remote requests",
  async (url) => {
    expect(await inspectSavedPreview({ ...preview, url }, "namespace")).toEqual(
      { status: "unsupported" },
    );
    expect(mockInfo).not.toHaveBeenCalled();
  },
);
it("explicitly resumes only the exact owned paused sandbox and verifies readiness", async () => {
  mockInfo.mockResolvedValue({
    sandboxId: "saved-id",
    state: "paused",
    metadata: { userID: "namespace" },
  });
  expect(
    await inspectSavedPreview(preview, "namespace", { resumePaused: true }),
  ).toEqual({ status: "running", url: preview.url });
  expect(mockConnect).toHaveBeenCalledWith("saved-id", expect.anything());
  expect(mockRun).toHaveBeenCalledWith(
    expect.stringContaining("for attempt in 1 2 3"),
    { timeoutMs: 13000 },
  );
});
it("a missing environment cannot be resumed or replaced", async () => {
  mockInfo.mockRejectedValue(new NotFoundError("gone"));
  expect(
    await inspectSavedPreview(preview, "namespace", { resumePaused: true }),
  ).toEqual({ status: "missing" });
  expect(mockConnect).not.toHaveBeenCalled();
});
it("does not connect a foreign paused environment even with resume requested", async () => {
  mockInfo.mockResolvedValue({
    sandboxId: "saved-id",
    state: "paused",
    metadata: { userID: "foreign" },
  });
  expect(
    await inspectSavedPreview(preview, "namespace", { resumePaused: true }),
  ).toEqual({ status: "unavailable" });
  expect(mockConnect).not.toHaveBeenCalled();
});
it("resuming does not claim a stopped server is running", async () => {
  mockInfo.mockResolvedValue({
    sandboxId: "saved-id",
    state: "paused",
    metadata: { userID: "namespace" },
  });
  mockRun.mockResolvedValue({ stdout: "RIFT_PREVIEW:7:000" });
  expect(
    await inspectSavedPreview(preview, "namespace", { resumePaused: true }),
  ).toEqual({ status: "stopped" });
});
