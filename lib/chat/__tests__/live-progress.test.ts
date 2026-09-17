import { buildLiveProgressPresentation } from "../live-progress";

describe("live progress presentation", () => {
  it("uses the latest public reasoning heading instead of a generic working label", () => {
    expect(
      buildLiveProgressPresentation([
        {
          type: "reasoning",
          text: "## Mapping the current interface\nInspecting the visible routes.",
        },
      ]),
    ).toMatchObject({
      title: "Mapping the current interface",
      phase: "reasoning",
      source: "reasoning",
    });
  });

  it("states that skills load without naming them", () => {
    // Loading playbooks is automatic; which packs is plumbing, not story.
    expect(
      buildLiveProgressPresentation([
        {
          type: "tool-find_skills",
          state: "input-available",
          input: { task: "Build a responsive Next.js page" },
        },
      ]).title,
    ).toBe("Loading skills");

    expect(
      buildLiveProgressPresentation([
        {
          type: "tool-find_skills",
          state: "output-available",
          output: {
            activeSkills: [
              { name: "React / Next Best Practices" },
              { name: "Landing Page Craft" },
            ],
          },
        },
      ]).title,
    ).toBe("Skills loaded");
  });

  it("uses the current todo as the observable Build step", () => {
    expect(
      buildLiveProgressPresentation([
        {
          type: "tool-todo_write",
          state: "output-available",
          output: {
            currentTodos: [
              { content: "Mapping the navigation", status: "completed" },
              {
                content: "Verifying responsive states",
                status: "in_progress",
              },
            ],
          },
        },
      ]),
    ).toMatchObject({
      title: "Verifying responsive states",
      phase: "reasoning",
      source: "todo",
      toolName: "todo_write",
    });
  });

  it.each([
    ["pnpm test -- --runInBand", "Running focused tests"],
    ["pnpm build", "Verifying the production build"],
    ["pnpm lint", "Checking code quality"],
    ["rg -n Sidebar app", "Inspecting the project"],
  ])("maps terminal command %s to named public progress", (command, title) => {
    expect(
      buildLiveProgressPresentation([
        {
          type: "tool-run_terminal_cmd",
          state: "input-available",
          input: { command },
        },
      ]),
    ).toMatchObject({ title, phase: "terminal", source: "tool" });
  });

  it("names file work from its real action and bounded target", () => {
    expect(
      buildLiveProgressPresentation([
        {
          type: "tool-file",
          state: "input-available",
          input: { action: "edit", path: "/workspace/app/page.tsx" },
        },
      ]).title,
    ).toBe("Updating page.tsx");
  });

  it("presents isolated browsing as a named Build step", () => {
    expect(
      buildLiveProgressPresentation([
        {
          type: "tool-browse_url",
          state: "input-available",
          input: { url: "https://example.com/docs" },
        },
      ]),
    ).toMatchObject({
      title: "Reading the selected page",
      phase: "working",
      toolName: "browse_url",
    });
  });

  it("ignores heartbeats and never falls back to Working or Starting agent", () => {
    const presentation = buildLiveProgressPresentation([
      { type: "data-agent-heartbeat", data: { at: 1 } },
    ]);

    expect(presentation.title).toBe("Planning next moves");
    expect(presentation.title).not.toMatch(/working|starting agent/i);
  });

  it("never surfaces provider-redacted reasoning as progress copy", () => {
    const presentation = buildLiveProgressPresentation([
      { type: "reasoning", text: "[REDACTED][REDACTED]" },
      { type: "data-agent-heartbeat", data: { at: 2 } },
    ]);

    expect(presentation.title).toBe("Planning next moves");
    expect(presentation.title).not.toContain("REDACTED");
  });
});

it("shows automatic provider recovery and restores normal progress afterwards", () => {
  const parts = [
    { type: "text", text: "Completed the edit." },
    {
      type: "data-provider-capacity",
      data: { status: "waiting", retryAt: 120000 },
    },
  ];
  expect(buildLiveProgressPresentation(parts).title).toBe(
    "Waiting for provider · resumes automatically",
  );
  parts[1].data!.status = "resuming";
  expect(buildLiveProgressPresentation(parts).title).toBe(
    "Writing the response",
  );
});

describe("terminal output follows its actual tool lifecycle", () => {
  const terminal = (
    state: string,
    command = "sleep 630",
    toolCallId = "command-a",
  ) => ({
    type: "tool-run_terminal_cmd",
    toolCallId,
    state,
    input: { command },
  });
  const output = (toolCallId: unknown = "command-a") => ({
    type: "data-terminal",
    data: { toolCallId, terminal: "build RIFT_SOAK_1" },
  });

  it.each(["input-streaming", "input-available"])(
    "keeps %s commands running while output arrives",
    (state) => {
      expect(
        buildLiveProgressPresentation([terminal(state), output()]).title,
      ).toBe("Running command");
    },
  );
  it.each(["output-available", "output-error"])(
    "does not revive %s commands when output is replayed",
    (state) => {
      expect(
        buildLiveProgressPresentation([terminal(state), output()]).title,
      ).toBe("Reviewing command results");
    },
  );
  it("classifies the actual command instead of words in its output", () => {
    expect(
      buildLiveProgressPresentation([
        terminal("input-available", "pnpm test"),
        output(),
      ]).title,
    ).toBe("Running focused tests");
    expect(
      buildLiveProgressPresentation([
        terminal("output-available", "pnpm test"),
        output(),
      ]).title,
    ).toBe("Reviewing test results");
  });
  it("matches the output to its own concurrent command", () => {
    expect(
      buildLiveProgressPresentation([
        terminal("input-available", "pnpm test", "command-a"),
        terminal("output-available", "pnpm build", "command-b"),
        output("command-a"),
      ]).title,
    ).toBe("Running focused tests");
  });
  it.each(["missing", undefined, null, 42])(
    "ignores orphan or malformed output IDs: %s",
    (toolCallId) => {
      const chunk = {
        type: "data-terminal",
        data: { toolCallId, terminal: "output" },
      };
      expect(buildLiveProgressPresentation([chunk]).title).toBe(
        "Planning next moves",
      );
      expect(
        buildLiveProgressPresentation([terminal("input-available"), chunk])
          .title,
      ).toBe("Running command");
    },
  );
  it("uses the actual tool presentation for verification output", () => {
    expect(
      buildLiveProgressPresentation([
        {
          type: "tool-verify_app",
          toolCallId: "verify-a",
          state: "input-available",
        },
        output("verify-a"),
      ]).title,
    ).toBe("Verifying the app");
  });
});
