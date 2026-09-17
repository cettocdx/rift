import {
  normalizeAgentRosterConfiguration,
  renderAgentRosterSkillInstructions,
} from "@/lib/ai/agents/pet-roster";
import { resolveAgentRuntimePolicy } from "@/lib/ai/agents/runtime-policy";
import { createTools, type McpToolBundle } from "../index";

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

it("keeps an explicit local selection in the validating manager when service configuration is missing", () => {
  const { HybridSandboxManager } = jest.requireMock(
    "../utils/hybrid-sandbox-manager",
  );
  const { DefaultSandboxManager } = jest.requireMock(
    "../utils/sandbox-manager",
  );
  HybridSandboxManager.mockClear();
  DefaultSandboxManager.mockClear();
  createTools(
    "owner",
    "chat",
    { write: jest.fn() } as never,
    "agent",
    {} as never,
    [],
    false,
    false,
    "assistant",
    "runner-selected",
    undefined,
  );
  expect(HybridSandboxManager).toHaveBeenCalledWith(
    "owner",
    expect.any(Function),
    "runner-selected",
    "",
    null,
    undefined,
    undefined,
    undefined,
    expect.objectContaining({
      connection: expect.objectContaining({ environmentFallback: false }),
    }),
    expect.objectContaining({ client: undefined, serviceKey: undefined }),
  );
  expect(DefaultSandboxManager).not.toHaveBeenCalled();
});

const ownedReadTool = {} as never;

it("keeps the prepared checkout in the run context across provider tool rebuilds", () => {
  const { createRunTerminalCmd } = jest.requireMock("../run-terminal-cmd");
  const first = createTools(
    "owner",
    "chat",
    { write: jest.fn() } as never,
    "agent",
    {} as never,
    [],
    false,
    false,
  );
  const firstContext = createRunTerminalCmd.mock.calls.at(-1)[0];
  first.setProjectWorkingDirectory("/home/user/selected-repo");
  expect(firstContext.projectWorkingDirectory).toBe("/home/user/selected-repo");
  first.getToolsForModel("anthropic/claude-sonnet-4");
  expect(
    createRunTerminalCmd.mock.calls.at(-1)[0].projectWorkingDirectory,
  ).toBe("/home/user/selected-repo");
  createTools(
    "owner",
    "other-chat",
    { write: jest.fn() } as never,
    "agent",
    {} as never,
    [],
    false,
    false,
  );
  expect(
    createRunTerminalCmd.mock.calls.at(-1)[0].projectWorkingDirectory,
  ).toBeUndefined();
});
const ownedWriteTool = {} as never;
const otherTool = {} as never;

const mcpTools: McpToolBundle = {
  all: {
    mcp_owned_read: ownedReadTool,
    mcp_owned_write: ownedWriteTool,
    mcp_other_read: otherTool,
  },
  planReadOnly: {
    mcp_owned_read: ownedReadTool,
    mcp_other_read: otherTool,
  },
  byServerId: {
    "server-owned": {
      mcp_owned_read: ownedReadTool,
      mcp_owned_write: ownedWriteTool,
    },
    "server-other": { mcp_other_read: otherTool },
  },
  planReadOnlyByServerId: {
    "server-owned": { mcp_owned_read: ownedReadTool },
    "server-other": { mcp_other_read: otherTool },
  },
};

function runtimePolicy(
  permissionPreset: "read-only" | "workspace-write",
  includeFindSkills = true,
  leadingToolIds: string[] = [],
) {
  const configuration = normalizeAgentRosterConfiguration({
    activeAgentId: "build-engineer",
    workflowAgentIds: ["build-engineer"],
    customAgents: [
      {
        id: "agent-atlas",
        mention: "@agent:atlas",
        enabled: true,
        name: "Atlas",
        petId: "wolf",
        roleName: "Systems Architect",
        mission: "Review architecture boundaries and return verified actions.",
        permissionPreset,
        toolIds: [
          ...leadingToolIds,
          ...(includeFindSkills ? ["find_skills"] : []),
          "file",
          "run_terminal_cmd",
          "todo_write",
          "delegate_task",
          "verify_app",
          "expose_preview",
          "create_note",
        ],
        mcpServerIds: ["server-owned", "server-not-connected"],
        skillIds: [
          "react-best-practices",
          "sql-data",
          "concise-expert",
          "web-vuln-hunting",
        ],
      },
    ],
    teams: [],
  });
  return resolveAgentRuntimePolicy(
    [
      {
        name: "RIFT Agent Crew",
        instructions: renderAgentRosterSkillInstructions(configuration),
        scope: "app",
        catalog_id: "rift-agent-roster",
      },
    ],
    "@agent:atlas inspect the implementation",
  );
}

function toolsFor(
  permissionPreset: "read-only" | "workspace-write",
  policy = runtimePolicy(permissionPreset),
  mode: "agent" | "ask" = "agent",
  integrations: McpToolBundle = mcpTools,
) {
  return createTools(
    "user-agent-policy",
    "chat-agent-policy",
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
    integrations,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "app",
    "@agent:atlas inspect the implementation",
    undefined,
    policy,
  ).tools;
}

describe("custom agent runtime tool policy", () => {
  it("keeps only mandatory Build skill selection when the roster source is unavailable", () => {
    const unavailable = resolveAgentRuntimePolicy(
      [],
      "@agent:atlas inspect the implementation",
      { rosterAvailable: false },
    );

    expect(Object.keys(toolsFor("workspace-write", unavailable))).toEqual([
      "find_skills",
    ]);
  });

  it("keeps unavailable roster profiles fail-closed in Plan mode", () => {
    const unavailable = resolveAgentRuntimePolicy(
      [],
      "@agent:atlas inspect the implementation",
      { rosterAvailable: false },
    );
    expect(
      Object.keys(toolsFor("workspace-write", unavailable, "ask")),
    ).toEqual(["find_skills"]);
  });

  it("intersects Plan reads with the exact profile allowlist and keeps its file read-only", () => {
    const tools = toolsFor(
      "workspace-write",
      runtimePolicy("workspace-write"),
      "ask",
    );
    expect(tools).toHaveProperty("file");
    expect(tools).toHaveProperty("mcp_owned_read");
    expect(tools).not.toHaveProperty("mcp_owned_write");
    expect(tools).not.toHaveProperty("list_files");
    expect(tools).not.toHaveProperty("browse_url");
    expect(tools).not.toHaveProperty("run_terminal_cmd");
    const schema = (tools.file as { inputSchema: { safeParse: Function } })
      .inputSchema;
    expect(
      schema.safeParse({
        action: "write",
        path: "/root/project/README.md",
        brief: "Write",
        text: "changed",
      }).success,
    ).toBe(false);
  });

  it("does not let a custom profile remove mandatory Build skill selection", () => {
    const tools = toolsFor(
      "workspace-write",
      runtimePolicy("workspace-write", false),
    );

    expect(tools).toHaveProperty("find_skills");
    expect(tools).toHaveProperty("file");
  });

  it("intersects base tools and exact owner-checked MCP server ids", () => {
    const tools = toolsFor("workspace-write");

    expect(tools).toHaveProperty("file");
    expect(tools).toHaveProperty("run_terminal_cmd");
    expect(tools).toHaveProperty("delegate_task");
    expect(tools).toHaveProperty("verify_app");
    expect(tools).toHaveProperty("expose_preview");
    expect(tools).toHaveProperty("create_note");
    expect(tools).toHaveProperty("mcp_owned_read");
    expect(tools).toHaveProperty("mcp_owned_write");
    expect(tools).not.toHaveProperty("mcp_other_read");
    expect(tools).toHaveProperty("todo_write");
  });

  it("removes terminal and mutating MCP access for a read-only profile", () => {
    const tools = toolsFor("read-only");

    expect(tools).toHaveProperty("file");
    expect(tools).toHaveProperty("delegate_task");
    expect(tools).toHaveProperty("find_skills");
    expect(tools).toHaveProperty("mcp_owned_read");
    expect(tools).not.toHaveProperty("run_terminal_cmd");
    expect(tools).not.toHaveProperty("todo_write");
    expect(tools).not.toHaveProperty("verify_app");
    expect(tools).not.toHaveProperty("expose_preview");
    expect(tools).not.toHaveProperty("create_note");
    expect(tools).not.toHaveProperty("mcp_owned_write");
    expect(tools).not.toHaveProperty("mcp_other_read");

    const schema = (tools.file as { inputSchema: { safeParse: Function } })
      .inputSchema;
    expect(
      schema.safeParse({
        action: "read",
        path: "/workspace/README.md",
        brief: "Read the project overview",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        action: "write",
        path: "/workspace/README.md",
        brief: "Overwrite the project overview",
        text: "changed",
      }).success,
    ).toBe(false);
  });

  it("keeps isolated public browsing available to an explicitly allowlisted read-only profile", () => {
    const tools = toolsFor(
      "read-only",
      runtimePolicy("read-only", true, ["browse_url"]),
    );

    expect(tools).toHaveProperty("browse_url");
    expect(tools).not.toHaveProperty("run_terminal_cmd");
  });
});

it("lazy discovery rebuilds into the same SDK set while enforcing read-only and exact server restrictions", async () => {
  const integrations: McpToolBundle = {
    all: {},
    planReadOnly: {},
    byServerId: {},
    planReadOnlyByServerId: {},
    discover: async () => {
      const read = { description: "GitHub read", execute: jest.fn() };
      const write = { description: "GitHub write", execute: jest.fn() };
      Object.assign(integrations.all, {
        mcp_owned_read: read,
        mcp_owned_write: write,
        mcp_other_read: read,
      });
      Object.assign(integrations.planReadOnly, {
        mcp_owned_read: read,
        mcp_other_read: read,
      });
      integrations.byServerId!["server-owned"] = {
        mcp_owned_read: read,
        mcp_owned_write: write,
      };
      integrations.byServerId!["server-other"] = { mcp_other_read: read };
      integrations.planReadOnlyByServerId!["server-owned"] = {
        mcp_owned_read: read,
      };
      integrations.planReadOnlyByServerId!["server-other"] = {
        mcp_other_read: read,
      };
      return { servers: ["GitHub"] };
    },
  };
  const tools = toolsFor(
    "read-only",
    runtimePolicy("read-only"),
    "agent",
    integrations,
  );
  expect(tools).not.toHaveProperty("mcp_owned_read");
  await tools.search_connected_tools.execute!(
    { query: "github" },
    { toolCallId: "find", messages: [] },
  );
  expect(tools).toHaveProperty("mcp_owned_read");
  expect(tools).not.toHaveProperty("mcp_owned_write");
  expect(tools).not.toHaveProperty("mcp_other_read");
});
