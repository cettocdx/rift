/** @jest-environment node */
import { NextRequest } from "next/server";
const mockAuth = jest.fn(),
  mockChat = jest.fn(),
  mockProject = jest.fn(),
  mockNamespace = jest.fn(),
  mockSaved = jest.fn(),
  mockInspect = jest.fn();
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: () => mockAuth(),
}));
jest.mock("@/lib/db/actions", () => ({
  getChatById: (...args: unknown[]) => mockChat(...args),
}));
jest.mock("@/lib/projects/project-runtime", () => ({
  resolveProjectRuntimeContext: (...args: unknown[]) => mockProject(...args),
  resolveChatSandboxNamespace: (...args: unknown[]) => mockNamespace(...args),
}));
jest.mock("@/lib/preview/saved-preview", () => ({
  loadSavedPreview: (...args: unknown[]) => mockSaved(...args),
}));
jest.mock("@/lib/preview/status", () => ({
  inspectSavedPreview: (...args: unknown[]) => mockInspect(...args),
}));
import { POST } from "../route";
import { ChatSDKError } from "@/lib/errors";
const preview = { url: "https://3000-original.e2b.app", port: 3000 };
const request = (
  body: unknown = { chatId: "chat", previewUrl: preview.url },
  headers: Record<string, string> = { origin: "http://localhost" },
) =>
  new NextRequest("http://localhost/api/preview/resume", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  jest.resetAllMocks();
  mockAuth.mockResolvedValue({ userId: "owner" });
  mockChat.mockResolvedValue({ id: "chat", user_id: "owner" });
  mockProject.mockResolvedValue({ sandboxNamespace: "project-ns" });
  mockNamespace.mockReturnValue("project-ns");
  mockSaved.mockResolvedValue(preview);
  mockInspect.mockResolvedValue({ status: "running", url: preview.url });
});
it.each([
  {},
  { origin: "https://evil.com" },
  { origin: "http://localhost", "sec-fetch-site": "cross-site" },
])(
  "rejects missing/cross-origin authority %j before any operation",
  async (headers) => {
    expect((await POST(request(undefined, headers))).status).toBe(403);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockInspect).not.toHaveBeenCalled();
  },
);
it("authenticates before data access", async () => {
  mockAuth.mockRejectedValue(new ChatSDKError("unauthorized:chat"));
  expect((await POST(request())).status).toBe(401);
  expect(mockChat).not.toHaveBeenCalled();
  expect(mockInspect).not.toHaveBeenCalled();
});
it.each([null, { user_id: "foreign" }])(
  "rejects inaccessible chat %s",
  async (chat) => {
    mockChat.mockResolvedValue(chat);
    expect((await POST(request())).status).toBe(404);
    expect(mockSaved).not.toHaveBeenCalled();
    expect(mockInspect).not.toHaveBeenCalled();
  },
);
it.each([{ chatId: "chat" }, { previewUrl: preview.url }, null])(
  "requires both identity fields %j",
  async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mockInspect).not.toHaveBeenCalled();
  },
);
it("uses only owned persisted namespace and exact saved identity for explicit resume", async () => {
  const response = await POST(
    request({
      chatId: "chat",
      previewUrl: preview.url,
      namespace: "foreign",
      sandboxId: "other",
    }),
  );
  expect(await response.json()).toEqual({
    chatId: "chat",
    previewUrl: preview.url,
    port: 3000,
    status: "running",
    url: preview.url,
  });
  expect(mockInspect).toHaveBeenCalledWith(preview, "project-ns", {
    resumePaused: true,
  });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("preserves legacy per-user namespace", async () => {
  mockNamespace.mockReturnValue(undefined);
  await POST(request());
  expect(mockInspect).toHaveBeenCalledWith(preview, "owner", {
    resumePaused: true,
  });
});
it("does not resume stale client evidence", async () => {
  expect(
    await (
      await POST(request({ chatId: "chat", previewUrl: "https://old.e2b.app" }))
    ).json(),
  ).toMatchObject({ status: "stale" });
  expect(mockInspect).not.toHaveBeenCalled();
});
it("does not resume without persisted evidence", async () => {
  mockSaved.mockResolvedValue(null);
  expect(await (await POST(request())).json()).toMatchObject({
    status: "stale",
  });
  expect(mockInspect).not.toHaveBeenCalled();
});
it("discards health when the saved preview changes while resuming", async () => {
  mockSaved
    .mockResolvedValueOnce(preview)
    .mockResolvedValueOnce({ ...preview, url: "https://3000-new.e2b.app" });
  expect(await (await POST(request())).json()).toMatchObject({
    status: "stale",
    previewUrl: "https://3000-new.e2b.app",
  });
});
it("does not claim deletion on service failures", async () => {
  mockSaved.mockRejectedValue(new Error("offline"));
  expect((await POST(request())).status).toBe(503);
  expect(mockInspect).not.toHaveBeenCalled();
});
