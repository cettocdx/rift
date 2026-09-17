import type { ChatMode, ChatPurpose } from "@/types/chat";
import { createTools, type McpToolBundle } from "../index";
import { DefaultSandboxManager } from "../utils/sandbox-manager";

jest.mock("../utils/sandbox-manager", () => ({
  DefaultSandboxManager: jest.fn().mockImplementation(() => ({
    getSandbox: jest.fn(),
  })),
}));

jest.mock("../utils/hybrid-sandbox-manager", () => ({
  HybridSandboxManager: jest.fn().mockImplementation(() => ({
    getSandbox: jest.fn(),
  })),
}));

jest.mock("../run-terminal-cmd", () => ({
  createRunTerminalCmd: jest.fn(() => ({ execute: jest.fn() })),
}));

const readMcpTool = {} as never;
const writeMcpTool = {} as never;

const mcpTools: McpToolBundle = {
  all: {
    mcp_docs_read: readMcpTool,
    mcp_repo_write: writeMcpTool,
  },
  planReadOnly: {
    mcp_docs_read: readMcpTool,
  },
};

function toolsFor(mode: ChatMode, purpose: ChatPurpose) {
  return createTools(
    "user-plan-boundary",
    "chat-plan-boundary",
    {} as never,
    mode,
    {} as never,
    undefined,
    true,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    mcpTools,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    purpose,
    "Plan the requested product",
  ).tools;
}

describe("Build Plan tool boundary", () => {
  it("passes a selected original file through final Plan and Agent tools without dropping the approval gate", async () => {
    const workingFile = {
      grantId: "2c097a16-0944-4f23-867c-cc8cde0aebf6",
      name: "notes.md",
      relativePath: "notes.md",
    };
    const gate = jest.fn(async () => {
      throw new Error("No approval");
    });
    const args: Parameters<typeof createTools> = [
      "owner",
      "chat",
      {} as never,
      "ask",
      {} as never,
    ];
    args[10] = "service";
    args[26] = "app";
    args[32] = gate;
    args[33] = workingFile;
    const plan = createTools(...args).tools as Record<string, any>;
    expect(plan.desktop_workspace_write).toBeUndefined();
    expect(plan.read_run_archive).toBeUndefined();
    expect(
      plan.desktop_workspace_read.inputSchema.safeParse({
        ...workingFile,
        brief: "Read",
      }).success,
    ).toBe(true);
    expect(
      plan.desktop_workspace_read.inputSchema.safeParse({
        ...workingFile,
        relativePath: "sibling.md",
        brief: "Read",
      }).success,
    ).toBe(false);
    args[3] = "agent";
    const runtime = createTools(...args);
    const agent = runtime.getToolsForModel("gpt-5.6-sol") as Record<
      string,
      any
    >;
    expect(agent.read_run_archive?.execute).toEqual(expect.any(Function));
    expect(
      agent.desktop_workspace_write.inputSchema.safeParse({
        ...workingFile,
        content: "new",
        brief: "Write",
      }).success,
    ).toBe(false);
    await expect(
      agent.desktop_workspace_write.execute(
        {
          ...workingFile,
          content: "new",
          expectedVersion: "a".repeat(64),
          brief: "Write",
        },
        { toolCallId: "edit-original", messages: [] },
      ),
    ).rejects.toThrow("No approval");
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "desktop_workspace_write" }),
    );
  });

  it("exposes read-only research and workspace tools without execution or mutation", () => {
    const tools = toolsFor("ask", "app");

    expect(tools).toHaveProperty("find_skills");
    expect(tools).toHaveProperty("mcp_docs_read");
    expect(tools).not.toHaveProperty("mcp_repo_write");
    expect(tools).not.toHaveProperty("run_terminal_cmd");
    expect(tools).not.toHaveProperty("interact_terminal_session");
    expect(tools).toHaveProperty("file");
    expect(tools).toHaveProperty("list_files");
    expect(tools).not.toHaveProperty("todo_write");
    expect(tools).not.toHaveProperty("create_note");
    expect(tools).not.toHaveProperty("update_note");
    expect(tools).not.toHaveProperty("delete_note");
    expect(tools).not.toHaveProperty("generate_image");
    expect(tools).not.toHaveProperty("generate_video");
    expect(tools).not.toHaveProperty("verify_app");
    expect(tools).not.toHaveProperty("expose_preview");
  });

  it("lists and reads the existing cloud workspace without invoking a command", async () => {
    const files = {
      list: jest
        .fn()
        .mockResolvedValue([
          { name: "README.md", path: "/root/project/README.md", type: "file" },
        ]),
      read: jest.fn().mockResolvedValue("Existing project\nUse pnpm test"),
      write: jest.fn(),
    };
    const commands = { run: jest.fn() };
    jest.mocked(DefaultSandboxManager).mockImplementationOnce(
      () =>
        ({
          getSandbox: jest
            .fn()
            .mockResolvedValue({ sandbox: { files, commands } }),
        }) as never,
    );
    const tools = toolsFor("ask", "app") as Record<string, any>;
    const options = { toolCallId: "plan-list", messages: [] };
    const listing = await tools.list_files.execute(
      { path: "/root/project", brief: "Inspect project files" },
      options,
    );
    const result = await tools.file.execute(
      {
        action: "read",
        path: "/root/project/README.md",
        brief: "Read project instructions",
      },
      { ...options, toolCallId: "plan-read" },
    );
    expect(listing.entries).toEqual([
      expect.objectContaining({ name: "README.md" }),
    ]);
    expect(result.content).toContain("Existing project");
    expect(files.list).toHaveBeenCalledWith("/root/project");
    expect(files.read).toHaveBeenCalledWith(
      "/root/project/README.md",
      expect.anything(),
    );
    expect(files.write).not.toHaveBeenCalled();
    expect(commands.run).not.toHaveBeenCalled();
  });

  it.each(["write", "append", "edit", "view"])(
    "rejects %s in the Plan schema and execution boundary",
    async (action) => {
      const getSandbox = jest.fn();
      jest
        .mocked(DefaultSandboxManager)
        .mockImplementationOnce(() => ({ getSandbox }) as never);
      const tools = toolsFor("ask", "app") as Record<string, any>;
      const input = {
        action,
        path: "/root/project/README.md",
        brief: "Attempt mutation",
        text: "changed",
      };
      expect(tools.file.inputSchema.safeParse(input).success).toBe(false);
      const result = await tools.file.execute(input, {
        toolCallId: "blocked-plan-write",
        messages: [],
      });
      expect(result.error).toMatch(/read.only/i);
      expect(getSandbox).not.toHaveBeenCalled();
    },
  );

  it("preserves existing non-Build Ask behavior", () => {
    const tools = toolsFor("ask", "security");

    expect(tools).toHaveProperty("create_note");
    expect(tools).toHaveProperty("update_note");
    expect(tools).toHaveProperty("delete_note");
    expect(tools).toHaveProperty("mcp_docs_read");
    expect(tools).toHaveProperty("mcp_repo_write");
  });

  it("preserves the complete Agent tool set", () => {
    const tools = toolsFor("agent", "app");

    expect(tools).toHaveProperty("run_terminal_cmd");
    expect(tools).toHaveProperty("file");
    expect(tools).not.toHaveProperty("report_finding");
    expect(tools).toHaveProperty("mcp_docs_read");
    expect(tools).toHaveProperty("mcp_repo_write");
  });

  it("keeps Hack-specific evidence tools inside the security workspace", () => {
    const previousRagKey = process.env.PREVIEW_RAG_API_KEY;
    process.env.PREVIEW_RAG_API_KEY = "test-preview-rag-key";

    try {
      const hackTools = toolsFor("agent", "security");
      const buildTools = toolsFor("agent", "app");

      expect(hackTools).toHaveProperty("report_finding");
      expect(hackTools).toHaveProperty("security_search");
      expect(buildTools).not.toHaveProperty("report_finding");
      expect(buildTools).not.toHaveProperty("security_search");
    } finally {
      if (previousRagKey === undefined) {
        delete process.env.PREVIEW_RAG_API_KEY;
      } else {
        process.env.PREVIEW_RAG_API_KEY = previousRagKey;
      }
    }
  });
});

it("gives Hack file delivery and keyless browsing without media or Build leakage", () => {
  const tools = toolsFor("agent", "security");
  expect(tools).toHaveProperty("browse_url");
  expect(tools).toHaveProperty("list_files");
  expect(tools).toHaveProperty("file");
  expect(tools).toHaveProperty("get_terminal_files");
});
it("exposes owner-granted computer tools to Hack but requires a backend identity", () => {
  const args: Parameters<typeof createTools> = [
    "owner",
    "chat",
    {} as never,
    "agent",
    {} as never,
  ];
  args[26] = "security";
  expect(createTools(...args).tools).not.toHaveProperty(
    "desktop_access_status",
  );
  args[10] = "service";
  expect(createTools(...args).tools).toHaveProperty("desktop_access_status");
});
