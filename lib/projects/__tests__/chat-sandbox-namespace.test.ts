import {
  deriveChatSandboxNamespace,
  deriveProjectSandboxNamespace,
} from "@/lib/projects/project-runtime";

describe("deriveChatSandboxNamespace", () => {
  const secret = "test-secret";
  it("is stable, prefixed, and hides both ids", () => {
    const a = deriveChatSandboxNamespace("user_1", "chat_1", secret);
    expect(a).toBe(deriveChatSandboxNamespace("user_1", "chat_1", secret));
    expect(a).toMatch(/^rift-chat-[A-Za-z0-9_-]{43}$/);
    expect(a).not.toContain("user_1");
    expect(a).not.toContain("chat_1");
  });
  it("changes with either id and never collides with the project namespace", () => {
    const a = deriveChatSandboxNamespace("user_1", "chat_1", secret);
    expect(deriveChatSandboxNamespace("user_1", "chat_2", secret)).not.toBe(a);
    expect(deriveChatSandboxNamespace("user_2", "chat_1", secret)).not.toBe(a);
    expect(deriveProjectSandboxNamespace("user_1", "chat_1", secret)).not.toBe(
      a,
    );
  });
});

describe("resolveChatSandboxNamespace migration", () => {
  const { resolveChatSandboxNamespace } = require("../project-runtime");
  const base = { userId: "u1", chatId: "c1", secret: "test-secret" };
  it("preserves both native per-user and OpenCode per-chat files", () => {
    expect(resolveChatSandboxNamespace({ ...base, chat: {} })).toBeUndefined();
    expect(
      resolveChatSandboxNamespace({
        ...base,
        chat: { opencode_sandbox_id: "old-sandbox" },
      }),
    ).toBe(deriveChatSandboxNamespace("u1", "c1", "test-secret"));
    expect(
      resolveChatSandboxNamespace({
        ...base,
        chat: { opencode_session_id: "old-session" },
      }),
    ).toBe(deriveChatSandboxNamespace("u1", "c1", "test-secret"));
  });
  it("always gives the validated project workspace precedence", () => {
    expect(
      resolveChatSandboxNamespace({
        ...base,
        projectNamespace: "project",
        chat: { opencode_sandbox_id: "old" },
      }),
    ).toBe("project");
  });
});
