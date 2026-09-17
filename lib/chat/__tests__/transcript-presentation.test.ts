import {
  classifyTranscriptTool,
  summarizeTranscriptTools,
  type TranscriptToolPart,
} from "../transcript-presentation";

const done = (
  name: string,
  input?: unknown,
  output?: unknown,
): TranscriptToolPart => ({
  type: `tool-${name}`,
  state: "output-available",
  input,
  output,
});
const pending = (name: string, input?: unknown): TranscriptToolPart => ({
  type: `tool-${name}`,
  state: "input-available",
  input,
});

describe("semantic transcript presentation", () => {
  it("summarizes an observed screenshot-input-screenshot cycle as desktop activity", () => {
    expect(
      summarizeTranscriptTools(
        [
          done("desktop_screenshot", {}, { ok: true }),
          done(
            "desktop_computer_action",
            { request: { action: "key", key: "escape" } },
            { ok: true },
          ),
          done("desktop_screenshot", {}, { ok: true }),
        ],
        "ready",
      ),
    ).toMatchObject({
      label: "Captured 2 screenshots, sent desktop input",
      category: "desktop",
      status: "completed",
      failed: 0,
    });
  });
  it.each([
    [
      "desktop_screenshot",
      "Captured a screenshot",
      "Capturing a screenshot",
      "Screenshot",
    ],
    [
      "desktop_computer_action",
      "Sent desktop input",
      "Sending desktop input",
      "Desktop input",
    ],
  ])(
    "presents %s accurately across its lifecycle",
    (name, completed, running, subject) => {
      expect(
        summarizeTranscriptTools([done(name, {}, { ok: true })], "ready"),
      ).toMatchObject({
        label: completed,
        category: "desktop",
        status: "completed",
      });
      expect(
        summarizeTranscriptTools([pending(name)], "streaming"),
      ).toMatchObject({
        label: running,
        category: "desktop",
        status: "running",
      });
      expect(
        summarizeTranscriptTools(
          [done(name, {}, { ok: false, code: "unavailable" })],
          "ready",
        ),
      ).toMatchObject({
        label: `${subject} failed`,
        category: "desktop",
        status: "failed",
        failed: 1,
      });
      expect(
        summarizeTranscriptTools(
          [{ ...pending(name), state: "approval-requested" }],
          "streaming",
        ),
      ).toMatchObject({
        label: `Approve ${subject.toLowerCase()}`,
        status: "awaiting-approval",
      });
    },
  );
  it("keeps screenshot failures separate from desktop input and readiness checks", () => {
    expect(
      summarizeTranscriptTools(
        [
          done("desktop_access_status", {}, { ok: false, code: "denied" }),
          done("desktop_screenshot", {}, { ok: false, code: "denied" }),
          done("desktop_computer_action", {}, { ok: true }),
        ],
        "ready",
      ),
    ).toMatchObject({
      label:
        "Desktop connection needs setup, screenshot failed, sent desktop input",
      failed: 1,
      status: "failed",
    });
    expect(
      summarizeTranscriptTools(
        [
          done("desktop_access_status", {}, { ok: true }),
          done("desktop_screenshot", {}, { ok: true }),
          done("desktop_computer_action", {}, { ok: true }),
        ],
        "ready",
      ).label,
    ).toBe(
      "Checked desktop connection, captured a screenshot, sent desktop input",
    );
  });
  it("keeps desktop screenshots separate from file images and web pages", () => {
    expect(
      summarizeTranscriptTools(
        [
          done("desktop_screenshot"),
          done("file", { action: "view" }),
          done("browse_url"),
          done("open_url"),
        ],
        "ready",
      ).label,
    ).toBe("Captured a screenshot, viewed an image, read 2 pages");
  });
  it("distinguishes an offline desktop readiness check from a failed file read", () => {
    const parts = [
      done(
        "desktop_access_status",
        {},
        {
          ok: false,
          code: "unavailable",
          error: "Desktop connection unavailable.",
        },
      ),
      done("run_terminal_cmd", {}, { result: { exitCode: 1 } }),
    ];
    expect(summarizeTranscriptTools(parts, "ready")).toMatchObject({
      label: "Desktop connection needs setup, command failed",
      detail: "1 failed · desktop setup needed",
      failed: 1,
    });
    expect(summarizeTranscriptTools(parts.slice(0, 1), "ready")).toMatchObject({
      category: "desktop",
      status: "needs-setup",
      failed: 0,
    });
  });
  it("does not soften actual desktop operation or unknown probe failures", () => {
    for (const part of [
      done("desktop_computer_action", {}, { ok: false, code: "unavailable" }),
      done("desktop_access_status", {}, { ok: false, code: "unexpected" }),
      {
        ...pending("desktop_access_status"),
        state: "output-error",
        errorText: "Bad response",
      },
    ])
      expect(summarizeTranscriptTools([part], "ready").failed).toBe(1);
    expect(
      summarizeTranscriptTools(
        [done("desktop_access_status", {}, { ok: true, access: {} })],
        "ready",
      ).label,
    ).toBe("Checked desktop connection");
  });
  it.each([
    ["file", { action: "read" }, "read"],
    ["file", { action: "view" }, "image"],
    ["file", { action: "write" }, "edit"],
    ["file", { action: "append" }, "edit"],
    ["file", { action: "edit" }, "edit"],
    ["file", { action: "unknown" }, "tool"],
    ["file", undefined, "tool"],
    ["desktop_workspace_read", {}, "read"],
    ["desktop_workspace_list", {}, "read"],
    ["desktop_workspace_list_grants", {}, "read"],
    ["desktop_workspace_write", {}, "edit"],
    ["desktop_access_status", {}, "desktop"],
    ["desktop_screenshot", {}, "desktop"],
    ["desktop_computer_action", {}, "desktop"],
    ["list_files", {}, "read"],
    ["apply_patch", {}, "edit"],
    ["run_terminal_cmd", {}, "command"],
    ["interact_terminal_session", {}, "command"],
    ["web_search", {}, "search"],
    ["browse_url", {}, "web"],
    ["delegate_task", {}, "agent"],
    ["todo_write", {}, "plan"],
    ["find_skills", {}, "skill"],
    ["mcp_repo_delete_everything", {}, "tool"],
    ["provider_magic_search", {}, "tool"],
    ["constructor", {}, "tool"],
    ["toString", {}, "tool"],
    ["__proto__", {}, "tool"],
  ])("classifies %s from its actual operation", (name, input, expected) => {
    expect(classifyTranscriptTool(done(name as string, input))).toBe(expected);
  });
  it("summarizes completed categories in action language", () => {
    expect(
      summarizeTranscriptTools(
        [
          done("read_file"),
          done("read_file"),
          done("run_terminal_cmd", {}, { result: { exitCode: 0 } }),
        ],
        "ready",
      ),
    ).toMatchObject({
      label: "Read files, ran a command",
      detail: "completed",
      failed: 0,
      running: false,
      status: "completed",
      category: "read",
    });
  });
  it("shows only a bounded basename for active file work, never file contents or hidden reasoning", () => {
    const parts = [
      pending("file", {
        action: "read",
        path: "/Users/private/project/Sidebar.tsx",
        brief: "secret reasoning",
        content: "credential",
      }),
      { type: "reasoning", text: "hidden thought" },
    ];
    const summary = summarizeTranscriptTools(parts, "streaming");
    expect(summary.label).toBe("Reading Sidebar.tsx");
    expect(summary.category).toBe("read");
    expect(summary.running).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(
      /private|secret|credential|hidden thought/,
    );
  });
  it.each([
    { error: "No matching text found" },
    { error: { code: "file_changed" } },
    { ok: false },
    { success: false },
    { exitCode: 1 },
    { result: { exitCode: 2, error: "process failed" } },
  ])(
    "does not report a completed SDK part with a failed output as successful %#",
    (output) => {
      const summary = summarizeTranscriptTools(
        [done("run_terminal_cmd", {}, output)],
        "ready",
      );
      expect(summary).toMatchObject({
        failed: 1,
        running: false,
        detail: "1 failed",
        status: "failed",
      });
      expect(summary.label).not.toMatch(/Ran|completed|updated/i);
    },
  );
  it("handles file/list error envelopes without relying on terminal exit codes", () => {
    expect(
      summarizeTranscriptTools(
        [
          done(
            "file",
            { action: "edit" },
            { error: "Could not find old text" },
          ),
          done("list_files", {}, { error: "Not found" }),
        ],
        "ready",
      ).failed,
    ).toBe(2);
  });
  it.each(["ready", "error"] as const)(
    "marks pending work interrupted when the chat is %s",
    (status) => {
      expect(
        summarizeTranscriptTools([pending("run_terminal_cmd")], status),
      ).toMatchObject({
        detail: "interrupted",
        status: "interrupted",
        failed: 0,
        running: false,
      });
    },
  );
  it.each([
    {
      state: "output-available",
      output: { result: { exitCode: null, aborted: true } },
    },
    {
      state: "output-available",
      output: { aborted: true },
    },
    {
      state: "output-error",
      errorText: "Stopped by user before the tool completed.",
    },
    {
      state: "output-available",
      output: {
        result: { exitCode: 130, error: "Command execution aborted by user" },
      },
    },
    {
      state: "output-available",
      output: { ok: false, agent: { name: "Review", status: "cancelled" } },
    },
  ])("distinguishes interruption from failure %#", (value) => {
    expect(
      summarizeTranscriptTools(
        [{ type: "tool-run_terminal_cmd", ...value }],
        "ready",
      ),
    ).toMatchObject({
      status: "interrupted",
      failed: 0,
      running: false,
      detail: "interrupted",
    });
  });
  it.each([
    { state: "output-denied" },
    {
      state: "output-error",
      errorText:
        "Action denied. Do not retry it without a new user instruction.",
    },
    { state: "approval-responded", approval: { approved: false } },
    {
      state: "output-available",
      output: { ok: false, execution: { stopReason: "approval-denied" } },
    },
  ])(
    "distinguishes denied approval from an operation that ran and failed %#",
    (value) => {
      expect(
        summarizeTranscriptTools(
          [{ type: "tool-file", input: { action: "write" }, ...value }],
          "ready",
        ),
      ).toMatchObject({
        detail: "1 not approved",
        failed: 0,
        running: false,
        status: "not-approved",
      });
    },
  );
  it("marks both explicit and externally awaited approvals without a running success label", () => {
    expect(
      summarizeTranscriptTools(
        [{ type: "tool-file", state: "approval-requested" }],
        "streaming",
      ),
    ).toMatchObject({
      status: "awaiting-approval",
      detail: "awaiting approval",
      running: false,
    });
    expect(
      summarizeTranscriptTools([pending("run_terminal_cmd")], "streaming", true)
        .detail,
    ).toBe("awaiting approval");
  });
  it("uses the real agent display name and stable profile identity", () => {
    const part = done(
      "delegate_task",
      { agentId: "ui-review" },
      {
        ok: true,
        agent: {
          id: "run_random",
          profileId: "ui-review",
          name: "UI review",
          status: "completed",
        },
      },
    );
    expect(summarizeTranscriptTools([part, part], "ready")).toMatchObject({
      label: "UI review updated",
      category: "agent",
      agents: [{ name: "UI review", identity: "ui-review" }],
      status: "completed",
    });
  });
  it("does not claim a delegated update when the agent failed or hit a limit", () => {
    const summary = summarizeTranscriptTools(
      [
        done(
          "delegate_task",
          {},
          {
            ok: false,
            agent: {
              name: "UI review",
              profileId: "ui-review",
              status: "failed",
            },
            execution: { stopReason: "step-limit" },
          },
        ),
      ],
      "ready",
    );
    expect(summary.status).toBe("failed");
    expect(summary.label).not.toContain("updated");
  });
  it("keeps the provided agent identity stable when output metadata arrives", () => {
    const input = { agentName: "UI review" };
    const before = summarizeTranscriptTools(
      [pending("delegate_task", input)],
      "streaming",
    );
    const after = summarizeTranscriptTools(
      [
        done("delegate_task", input, {
          agent: { name: "UI review", profileId: "new-profile", id: "new-run" },
        }),
      ],
      "ready",
    );
    expect(before.agents).toEqual([
      { name: "UI review", identity: "UI review" },
    ]);
    expect(after.agents).toEqual(before.agents);
  });
  it("preserves proper agent names after another activity in a mixed group", () => {
    const summary = summarizeTranscriptTools(
      [
        done("read_file"),
        done("delegate_task", { agentName: "UI review" }),
        done("delegate_task", { agentName: "Accessibility review" }),
      ],
      "ready",
    );
    expect(summary.label).toBe(
      "Read files, UI review, Accessibility review updated",
    );
    expect(summary.category).toBe("read");
  });
  it.each([
    ["send", "Sent terminal input"],
    ["view", "Read terminal output"],
    ["wait", "Checked terminal output"],
    ["kill", "Closed terminal session"],
  ])(
    "does not misreport a terminal %s action as a newly executed command",
    (action, label) => {
      expect(
        summarizeTranscriptTools(
          [
            done(
              "interact_terminal_session",
              { action },
              { result: { output: "ok", exitCode: 0 } },
            ),
          ],
          "ready",
        ).label,
      ).toBe(label);
    },
  );
  it("keeps command execution distinct from terminal output inspection", () => {
    expect(
      summarizeTranscriptTools(
        [
          done("run_terminal_cmd", {}, { result: { exitCode: 0 } }),
          done(
            "interact_terminal_session",
            { action: "view" },
            { result: { output: "ok" } },
          ),
        ],
        "ready",
      ).label,
    ).toBe("Ran a command, read terminal output");
  });
  it.each([
    [1, "failed", 1],
    [130, "interrupted", 0],
  ])("recognizes nested PTY exit %s", (exitCode, status, failed) => {
    expect(
      summarizeTranscriptTools(
        [
          done(
            "interact_terminal_session",
            { action: "wait" },
            { result: { output: "", exited: { exitCode } } },
          ),
        ],
        "ready",
      ),
    ).toMatchObject({ status, failed });
  });
  it("uses honest fallback for dynamic unknown provider or MCP calls", () => {
    expect(
      classifyTranscriptTool({
        type: "dynamic-tool",
        toolName: "mcp_provider_read",
      }),
    ).toBe("tool");
    const summary = summarizeTranscriptTools(
      [
        {
          type: "dynamic-tool",
          toolName: "mcp_provider_read",
          state: "output-available",
          output: { ok: true },
        },
      ],
      "ready",
    );
    expect(summary.label).toBe("Used a tool");
    expect(summary.category).toBe("tool");
  });

  it("distinguishes a reported MCP failure from an unconfirmed transport result", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "mcp_browserbase_start",
      state: "output-available",
    };
    expect(
      summarizeTranscriptTools(
        [
          {
            ...part,
            output: {
              isError: true,
              content: [{ type: "text", text: "Credentials required" }],
            },
          },
        ],
        "ready",
      ),
    ).toMatchObject({ status: "failed", failed: 1 });
    expect(
      summarizeTranscriptTools(
        [
          {
            ...part,
            output: {
              isError: true,
              code: "mcp_call_unconfirmed",
              executionStatus: "unconfirmed",
              retrySafe: false,
            },
          },
        ],
        "ready",
      ),
    ).toMatchObject({ status: "unknown", failed: 0 });
    expect(
      summarizeTranscriptTools(
        [
          {
            type: "tool-file",
            state: "output-available",
            output: "Tool error: example text inside a file",
          },
        ],
        "ready",
      ),
    ).toMatchObject({ status: "completed", failed: 0 });
  });
  it.each([undefined, "process-123"])(
    "preserves the terminal runtime's unknown outcome despite its diagnostic error (pid %s)",
    (pid) => {
      const summary = summarizeTranscriptTools(
        [
          done(
            "run_terminal_cmd",
            {},
            {
              result: {
                exitCode: null,
                pid,
                outcome: "unknown",
                output: "",
                error:
                  "The command result could not be confirmed. It may already have started or completed in the selected environment. Do not automatically repeat this command. Reconnect and inspect the process or affected files before deciding what to do next.",
              },
            },
          ),
        ],
        "ready",
      );
      expect(summary).toMatchObject({
        status: "unknown",
        failed: 0,
        detail: "completion not confirmed",
      });
    },
  );
  it.each([
    { exitCode: 1 },
    { status: "failed" },
    { ok: false },
    { success: false },
    { exited: { exitCode: 2 } },
  ])(
    "retains explicit failure evidence alongside unknown outcome: %j",
    (failure) => {
      expect(
        summarizeTranscriptTools(
          [
            done(
              "run_terminal_cmd",
              {},
              {
                result: {
                  exitCode: null,
                  outcome: "unknown",
                  error: "Diagnostic",
                  ...failure,
                },
              },
            ),
          ],
          "ready",
        ),
      ).toMatchObject({ status: "failed", failed: 1 });
    },
  );
  it("does not exempt other tools or terminal errors without an unknown outcome", () => {
    for (const part of [
      done(
        "run_terminal_cmd",
        {},
        { result: { exitCode: null, error: "Connection failed" } },
      ),
      done(
        "read_file",
        {},
        {
          result: { exitCode: null, outcome: "unknown", error: "Read failed" },
        },
      ),
      {
        ...done(
          "run_terminal_cmd",
          {},
          {
            result: { exitCode: null, outcome: "unknown", error: "Diagnostic" },
          },
        ),
        state: "output-error",
      },
      done(
        "run_terminal_cmd",
        {},
        {
          error: "Outer failure",
          result: { exitCode: null, outcome: "unknown", error: "Diagnostic" },
        },
      ),
    ]) {
      expect(summarizeTranscriptTools([part], "ready")).toMatchObject({
        status: "failed",
        failed: 1,
      });
    }
  });
  it("does not call a partial command result completed", () => {
    const summary = summarizeTranscriptTools(
      [
        done(
          "run_terminal_cmd",
          {},
          { result: { exitCode: null, output: "Still executing" } },
        ),
      ],
      "ready",
    );
    expect(summary).toMatchObject({
      status: "unknown",
      detail: "completion not confirmed",
      running: false,
    });
  });
  it("reports a successful background launch without claiming the process finished", () => {
    const summary = summarizeTranscriptTools(
      [
        done(
          "run_terminal_cmd",
          { is_background: true },
          { result: { pid: 42, output: "Background process started" } },
        ),
      ],
      "ready",
    );
    expect(summary.label).toBe("Started a background command");
    expect(summary.detail).not.toBe("completed");
    expect(summary.running).toBe(false);
  });
  it("keeps failures visible while another operation is actually running", () => {
    const summary = summarizeTranscriptTools(
      [
        done("file", { action: "write" }, { error: "failed" }),
        pending("read_file", { path: "other.ts" }),
      ],
      "streaming",
    );
    expect(summary.status).toBe("running");
    expect(summary.label).toBe("Reading other.ts");
    expect(summary.detail).toContain("1 failed");
    expect(summary.failed).toBe(1);
  });
  it("returns an honest empty summary and never mutates its inputs", () => {
    const parts = [done("read_file", { path: "a.ts" })];
    const before = JSON.stringify(parts);
    summarizeTranscriptTools(parts, "ready");
    expect(JSON.stringify(parts)).toBe(before);
    expect(summarizeTranscriptTools([], "ready")).toMatchObject({
      label: "Tool activity",
      status: "unknown",
      failed: 0,
      running: false,
    });
  });
});

it("distinguishes viewing an image from reading text and preserves failure states", () => {
  expect(
    summarizeTranscriptTools(
      [done("file", { action: "view", path: "preview.png" })],
      "ready",
    ),
  ).toMatchObject({ label: "Viewed an image", category: "image" });
  expect(
    summarizeTranscriptTools(
      [pending("file", { action: "view" })],
      "streaming",
    ),
  ).toMatchObject({ label: "Viewing an image", category: "image" });
  const failure = summarizeTranscriptTools(
    [done("file", { action: "view" }, { error: "Not found" })],
    "ready",
  );
  expect(failure.label).toBe("Image view failed");
  expect(failure.failed).toBe(1);
});
