/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "../route";
import { getChatById } from "@/lib/db/actions";
import { ensureSandboxConnection } from "@/lib/ai/tools/utils/sandbox";
import { resolveProjectRuntimeContext } from "@/lib/projects/project-runtime";
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: jest.fn(async () => ({ userId: "owner" })),
}));
jest.mock("@/lib/db/actions", () => ({ getChatById: jest.fn() }));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: jest.fn(() => ({})),
}));
jest.mock("@/lib/ai/tools/utils/sandbox", () => ({
  ensureSandboxConnection: jest.fn(),
}));
jest.mock("@/lib/projects/project-runtime", () => ({
  resolveProjectRuntimeContext: jest.fn(),
  resolveChatSandboxNamespace: jest.fn(
    ({ projectNamespace, chat }) =>
      projectNamespace ??
      (chat.opencode_sandbox_id ? "legacy-chat-scope" : undefined),
  ),
}));
const request = () =>
  new NextRequest("http://localhost/api/publish", {
    method: "POST",
    body: JSON.stringify({ chatId: "chat", title: "Demo" }),
  });
beforeEach(() => {
  jest.clearAllMocks();
  process.env.VERCEL_TOKEN = "test";
  process.env.CONVEX_SERVICE_ROLE_KEY = "test";
  jest
    .mocked(resolveProjectRuntimeContext)
    .mockResolvedValue({ purpose: "app", sandboxNamespace: "project-scope" });
  jest.mocked(ensureSandboxConnection).mockResolvedValue({
    sandbox: {
      commands: { run: jest.fn(async () => ({ stdout: "", exitCode: 0 })) },
    },
  } as never);
});
it.each([null, { user_id: "other" }])(
  "rejects absent or foreign chat before touching any sandbox: %p",
  async (chat) => {
    jest.mocked(getChatById).mockResolvedValue(chat as never);
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(ensureSandboxConnection).not.toHaveBeenCalled();
  },
);
it.each([
  [
    { user_id: "owner", project_id: "project" },
    "project-scope",
    "project-scope",
  ],
  [
    { user_id: "owner", opencode_sandbox_id: "legacy" },
    undefined,
    "legacy-chat-scope",
  ],
  [{ user_id: "owner" }, undefined, "owner"],
])(
  "uses the owned chat runtime rather than an unrelated user workspace",
  async (chat, namespace, expected) => {
    jest.mocked(getChatById).mockResolvedValue(chat as never);
    jest
      .mocked(resolveProjectRuntimeContext)
      .mockResolvedValue({ purpose: "app", sandboxNamespace: namespace });
    await POST(request());
    expect(resolveProjectRuntimeContext).toHaveBeenCalledWith({
      userId: "owner",
      chat,
    });
    expect(ensureSandboxConnection).toHaveBeenCalledWith(
      expect.objectContaining({ userID: "owner", sandboxNamespace: expected }),
    );
  },
);
