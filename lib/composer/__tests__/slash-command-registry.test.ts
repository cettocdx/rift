import { GOAL_OBJECTIVE_MAX_LENGTH } from "../goal-store";
import { OPERATIONS } from "@/lib/operations/operations";
import {
  SLASH_COMMAND_REGISTRY,
  filterSlashCommands,
  parseSlashCommand,
  resolveSlashCommand,
} from "../slash-command-registry";
import {
  getComposerSlashCommands,
  SLASH_COMMANDS,
  WEB_SLASH_COMMANDS,
} from "../palette-items";

describe("slash command registry", () => {
  it("contains unique canonical ids and every requested Codex/RIFT command", () => {
    const ids = SLASH_COMMAND_REGISTRY.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "approve",
        "cloud-environment",
        "compact",
        "fast",
        "feedback",
        "fork",
        "goal",
        "ide-context",
        "init",
        "mcp",
        "memories",
        "model",
        "personality",
        "plan",
        "project",
        "reasoning",
        "review",
        "side",
        "status",
        "worktree",
        "agent",
        "apps",
        "plugins",
        "clear",
        "new",
        "rename",
        "archive",
        "delete",
        "copy",
        "diff",
        "skills",
        "mention",
        "permissions",
        "ps",
        "stop",
        "resume",
        "usage",
        "theme",
      ]),
    );

    for (const command of SLASH_COMMAND_REGISTRY) {
      expect(command.action.id).toBe(command.id);
      expect(command.insert).toMatch(new RegExp(`^/${command.id}`));
      expect(command.purposes.length).toBeGreaterThan(0);
      if (!command.availability.web)
        expect(command.availability.reason).toBeTruthy();
    }
  });

  it("filters by prefixes, aliases, keywords, and surface availability", () => {
    expect(filterSlashCommands("/go").map((command) => command.id)).toEqual([
      "goal",
    ]);
    expect(filterSlashCommands("/bt").map((command) => command.id)).toEqual([
      "side",
    ]);
    expect(
      filterSlashCommands("dark mode").map((command) => command.id),
    ).toContain("theme");
    expect(
      filterSlashCommands("vim", {
        surface: "web",
        includeUnavailable: false,
      }),
    ).toEqual([]);
  });

  it("keeps pentest operations out of every normal chat slash catalog", () => {
    const pentestOperationIds = OPERATIONS.map((operation) => operation.id);

    expect(SLASH_COMMANDS.map((command) => command.id)).toEqual(
      SLASH_COMMAND_REGISTRY.map((command) => command.id),
    );
    expect(
      WEB_SLASH_COMMANDS.every((command) => !("operationId" in command)),
    ).toBe(true);
    for (const id of pentestOperationIds) {
      expect(SLASH_COMMANDS.map((command) => command.id)).not.toContain(id);
      expect(WEB_SLASH_COMMANDS.map((command) => command.id)).not.toContain(id);
      expect(resolveSlashCommand(id)).toBeUndefined();
      expect(parseSlashCommand(`/${id}`)).toEqual({
        kind: "unknown",
        name: id,
        rawArgs: "",
      });
    }
  });

  it("shows only executable web commands in the browser palette", () => {
    const browserRegistryItems = WEB_SLASH_COMMANDS.filter(
      (item) => !("operationId" in item),
    );
    expect(
      browserRegistryItems.every(
        (item) => "availability" in item && item.availability.web,
      ),
    ).toBe(true);
    expect(browserRegistryItems.map((item) => item.id)).not.toContain(
      "worktree",
    );
    expect(browserRegistryItems.map((item) => item.id)).not.toContain("vim");
    expect(browserRegistryItems.map((item) => item.id)).not.toContain(
      "ide-context",
    );
    expect(browserRegistryItems.map((item) => item.id)).toContain("mention");
    expect(resolveSlashCommand("mention")).toMatchObject({
      description: expect.stringContaining("@files"),
      availability: { web: true },
    });
  });

  it("does not restore the retired Local/Cloud execution picker as slash commands", () => {
    expect(resolveSlashCommand("local")).toBeUndefined();
    expect(resolveSlashCommand("cloud")).toBeUndefined();
    expect(WEB_SLASH_COMMANDS.map((command) => command.id)).not.toEqual(
      expect.arrayContaining(["local", "cloud"]),
    );
  });

  it("builds a purpose-safe Studio palette while retaining local controls", () => {
    const studioIds = getComposerSlashCommands({
      purpose: "image",
      surface: "web",
    }).map((command) => command.id);

    expect(studioIds).not.toEqual(
      expect.arrayContaining(["init", "review", "diff", "ps", "plan", "agent"]),
    );
    expect(studioIds).toEqual(
      expect.arrayContaining([
        "model",
        "fast",
        "new",
        "task",
        "apps",
        "plugins",
      ]),
    );
  });

  it("does not advertise host-only commands in the lite desktop composer", () => {
    const falselyAdvertised = SLASH_COMMAND_REGISTRY.filter(
      (command) => !command.availability.web && command.availability.desktop,
    );

    expect(falselyAdvertised).toEqual([]);
  });

  it("resolves documented aliases to their canonical definitions", () => {
    expect(resolveSlashCommand("/subagents")?.id).toBe("agent");
    expect(resolveSlashCommand("btw")?.id).toBe("side");
    expect(resolveSlashCommand("/quit")?.id).toBe("exit");
    expect(resolveSlashCommand("clean")?.id).toBe("stop");
    expect(resolveSlashCommand("pets")?.id).toBe("pet");
  });

  it("advertises only web commands backed by a truthful RIFT runtime", () => {
    for (const id of ["app", "copy", "fork", "memories", "resume"] as const) {
      expect(resolveSlashCommand(id)?.availability.web).toBe(true);
    }

    for (const id of [
      "approve",
      "archive",
      "compact",
      "feedback",
      "ide-context",
      "import",
      "pet",
      "raw",
      "side",
      "statusline",
      "title",
      "vim",
      "worktree",
    ] as const) {
      expect(resolveSlashCommand(id)).toMatchObject({
        availability: { web: false },
      });
      expect(resolveSlashCommand(id)?.availability.reason).toBeTruthy();
    }
  });
});

describe("parseSlashCommand", () => {
  it("parses an exact command line and safely tokenizes quoted arguments", () => {
    const parsed = parseSlashCommand(
      '  /plan "Review the auth flow" --focus security  ',
    );
    expect(parsed.kind).toBe("command");
    if (parsed.kind !== "command") throw new Error("Expected command");

    expect(parsed.command.id).toBe("plan");
    expect(parsed.invokedAs).toBe("plan");
    expect(parsed.rawArgs).toBe('"Review the auth flow" --focus security');
    expect(parsed.args).toEqual([
      "Review the auth flow",
      "--focus",
      "security",
    ]);
    expect(parsed.validation).toEqual({ valid: true });
  });

  it("preserves alias invocation while resolving the canonical command", () => {
    const parsed = parseSlashCommand("/btw why did this test fail?");
    expect(parsed).toMatchObject({
      kind: "command",
      invokedAs: "btw",
      rawArgs: "why did this test fail?",
      command: { id: "side" },
      validation: { valid: true },
    });
  });

  it("keeps /goal optional and enforces the shared objective maximum", () => {
    const view = parseSlashCommand("/goal");
    expect(view).toMatchObject({
      kind: "command",
      command: { id: "goal" },
      rawArgs: "",
      validation: { valid: true },
    });

    const tooLong = parseSlashCommand(
      `/goal ${"x".repeat(GOAL_OBJECTIVE_MAX_LENGTH + 1)}`,
    );
    expect(tooLong).toMatchObject({
      kind: "command",
      command: { id: "goal" },
      validation: { valid: false, code: "arguments_too_long" },
    });
  });

  it("reports missing, unexpected, and malformed arguments without executing them", () => {
    expect(parseSlashCommand("/sandbox-add-read-dir")).toMatchObject({
      kind: "command",
      validation: { valid: false, code: "arguments_required" },
    });
    expect(parseSlashCommand("/status now")).toMatchObject({
      kind: "command",
      validation: { valid: false, code: "arguments_not_allowed" },
    });
    expect(parseSlashCommand('/plan "unfinished')).toMatchObject({
      kind: "command",
      validation: { valid: false, code: "unterminated_quote" },
    });
  });

  it("accepts explicit destructive confirmations but rejects copy payloads", () => {
    expect(parseSlashCommand("/delete confirm")).toMatchObject({
      kind: "command",
      command: { id: "delete" },
      validation: { valid: true },
    });
    expect(parseSlashCommand("/logout confirm")).toMatchObject({
      kind: "command",
      command: { id: "logout" },
      validation: { valid: true },
    });
    expect(parseSlashCommand("/copy arbitrary text")).toMatchObject({
      kind: "command",
      command: { id: "copy" },
      validation: { valid: false, code: "arguments_not_allowed" },
    });
  });

  it("accepts an optional saved-task query for /resume", () => {
    expect(parseSlashCommand("/resume quarterly dashboard")).toMatchObject({
      kind: "command",
      command: { id: "resume" },
      args: ["quarterly", "dashboard"],
      rawArgs: "quarterly dashboard",
      validation: { valid: true },
    });
  });

  it("distinguishes unknown commands from ordinary or embedded content", () => {
    expect(parseSlashCommand("/does-not-exist value")).toEqual({
      kind: "unknown",
      name: "does-not-exist",
      rawArgs: "value",
    });
    for (const value of [
      "hello",
      "hello /goal ship it",
      "/goal ship it\nthen deploy",
      "//goal",
      "/",
      "`/goal ship it`",
    ]) {
      expect(parseSlashCommand(value)).toEqual({ kind: "not_command" });
    }
  });
});
