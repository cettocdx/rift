import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("project runtime wiring contract", () => {
  it("validates the fast chat request before persistence and tool creation", () => {
    const code = source("lib/api/chat-handler.ts");
    const validation = code.indexOf(
      "const projectRuntime = await resolveProjectRuntimeContext",
    );
    expect(validation).toBeGreaterThan(-1);
    expect(
      code.indexOf("handleInitialChatAndUserMessage({", validation),
    ).toBeGreaterThan(validation);
    expect(code.indexOf("} = createTools(", validation)).toBeGreaterThan(
      validation,
    );
    expect(code).toContain("projectId: projectRuntime.projectId");
  });

  it("validates agent-long before attachment sandbox staging", () => {
    const code = source("lib/api/agent-long-handler.ts");
    const validation = code.indexOf("resolveProjectRuntimeContext({");
    expect(validation).toBeGreaterThan(-1);
    expect(
      code.indexOf("new HybridSandboxManager(", validation),
    ).toBeGreaterThan(validation);
    expect(code.indexOf("tasks.trigger<", validation)).toBeGreaterThan(
      validation,
    );
  });

  it("revalidates inside the worker before creating tools or prewarming E2B", () => {
    const code = source("trigger/agent-long.ts");
    const validation = code.search(
      /measureSetup\("project",\s*\(\)\s*=>\s*resolveProjectRuntimeContext\(\{/,
    );
    const tools = code.indexOf(
      '} = phaseTimer.measureSync("tools",',
      validation,
    );
    const prewarm = code.indexOf(
      'await measureSetup("turnSandbox",',
      validation,
    );
    expect(validation).toBeGreaterThan(-1);
    expect(tools).toBeGreaterThan(validation);
    expect(prewarm).toBeGreaterThan(tools);
    expect(code.slice(tools, prewarm)).toContain("createTools(");
  });
});

it.each(["lib/api/chat-handler.ts", "trigger/agent-long.ts"])(
  "adds the authorized repository to the agent context in %s",
  (path) => {
    const code = source(path);
    expect(
      /projectGithubRepositoryReminder\(\s*projectRuntime\.githubRepository,\s*preparedRepository\?\.path,?\s*\)/.test(
        code,
      ),
    ).toBe(true);
    expect(
      /appendSystemReminderToLastUserMessage\(\s*finalMessages,\s*repositoryReminder,?\s*\)/.test(
        code,
      ),
    ).toBe(true);
  },
);

it.each(["lib/api/chat-handler.ts", "trigger/agent-long.ts"])(
  "prepares the authorized cloud checkout before constructing model context in %s",
  (path) => {
    const code = source(path);
    const preparation = code.indexOf("await prepareCloudProjectRepository({");
    expect(preparation).toBeGreaterThan(
      code.indexOf("const projectRuntime = await resolveProjectRuntimeContext"),
    );
    const preparedCall = code.slice(
      preparation,
      code.indexOf("});", preparation),
    );
    expect(preparedCall).toContain(
      "repository: projectRuntime.githubRepository",
    );
    expect(preparedCall).toContain(
      "sandboxNamespace: projectRuntime.sandboxNamespace",
    );
    expect(preparedCall).toContain("connection: githubConn");
    expect(preparedCall).toContain("ensureSandbox");
    const configured = code.indexOf(
      "setProjectWorkingDirectory(preparedRepository?.path)",
      preparation,
    );
    expect(configured).toBeGreaterThan(preparation);
    expect(configured).toBeLessThan(
      code.indexOf("const repositoryReminder =", preparation),
    );
    expect(
      code.indexOf("const repositoryReminder =", preparation),
    ).toBeGreaterThan(preparation);
  },
);
