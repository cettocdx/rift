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
import { GET } from "../route";
import { ChatSDKError } from "@/lib/errors";
const preview = { url: "https://3000-original.e2b.app", port: 3000 };
const request = (query = "chatId=chat") =>
  new NextRequest(`http://localhost/api/preview/status?${query}`);
beforeEach(() => {
  jest.resetAllMocks();
  mockAuth.mockResolvedValue({ userId: "owner" });
  mockChat.mockResolvedValue({ id: "chat", user_id: "owner" });
  mockProject.mockResolvedValue({ sandboxNamespace: "project-ns" });
  mockNamespace.mockReturnValue("project-ns");
  mockSaved.mockResolvedValue(preview);
  mockInspect.mockResolvedValue({ status: "running", url: preview.url });
});
it("authenticates before looking up any data", async () => {
  mockAuth.mockRejectedValue(new ChatSDKError("unauthorized:chat"));
  expect((await GET(request())).status).toBe(401);
  expect(mockChat).not.toHaveBeenCalled();
  expect(mockInspect).not.toHaveBeenCalled();
});
it.each([null, { user_id: "foreign" }])(
  "rejects inaccessible chat %s before reading preview or sandbox",
  async (chat) => {
    mockChat.mockResolvedValue(chat);
    expect((await GET(request())).status).toBe(404);
    expect(mockSaved).not.toHaveBeenCalled();
    expect(mockInspect).not.toHaveBeenCalled();
  },
);
it("uses persisted project context and returns identity with no cache", async () => {
  const response = await GET(
    request("chatId=chat&namespace=foreign&url=http://evil"),
  );
  expect(await response.json()).toEqual({
    chatId: "chat",
    previewUrl: preview.url,
    port: 3000,
    status: "running",
    url: preview.url,
  });
  expect(mockInspect).toHaveBeenCalledWith(preview, "project-ns");
  expect(mockSaved).toHaveBeenCalledWith("chat", "owner");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("preserves legacy per-user fallback", async () => {
  mockNamespace.mockReturnValue(undefined);
  await GET(request());
  expect(mockInspect).toHaveBeenCalledWith(preview, "owner");
});
it("fences a stale client identity before sandbox inspection", async () => {
  const response = await GET(
    request("chatId=chat&previewUrl=https://stale.e2b.app"),
  );
  expect(await response.json()).toMatchObject({
    chatId: "chat",
    previewUrl: preview.url,
    status: "stale",
  });
  expect(mockInspect).not.toHaveBeenCalled();
});
it("does not probe without persisted successful preview evidence", async () => {
  mockSaved.mockResolvedValue(null);
  expect(await (await GET(request())).json()).toMatchObject({
    status: "unavailable",
    previewUrl: null,
  });
  expect(mockInspect).not.toHaveBeenCalled();
});
it("does not claim missing when history lookup fails", async () => {
  mockSaved.mockRejectedValue(new Error("offline"));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ status: "transient" });
  expect(mockInspect).not.toHaveBeenCalled();
});

it("discards health when persisted preview changes during the probe", async () => {
  mockSaved
    .mockResolvedValueOnce(preview)
    .mockResolvedValueOnce({ ...preview, url: "https://3000-new.e2b.app" });
  expect(await (await GET(request())).json()).toMatchObject({
    status: "stale",
    previewUrl: "https://3000-new.e2b.app",
  });
});
it("rejects a foreign or unavailable persisted project before evidence lookup", async () => {
  mockProject.mockRejectedValue(new ChatSDKError("forbidden:chat"));
  expect((await GET(request())).status).toBe(403);
  expect(mockSaved).not.toHaveBeenCalled();
  expect(mockInspect).not.toHaveBeenCalled();
});
