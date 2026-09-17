import { describe, it, expect } from "@jest/globals";
import type { UIMessage } from "ai";
import {
  pruneToolOutputs,
  pruneModelMessages,
  filterEmptyAssistantMessages,
  repairAnthropicModelMessages,
  compactMessageForStorage,
  estimateSerializedSizeBytes,
} from "../prune-tool-outputs";

// Helper to create a UIMessage with tool parts
function makeAssistantMessage(
  parts: Array<Record<string, unknown>>,
  id = "msg-1",
): UIMessage {
  return { id, role: "assistant", parts: parts as any };
}

function makeUserMessage(text: string, id = "user-1"): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function makeToolPart(
  toolName: string,
  output: unknown,
  input: Record<string, unknown> = {},
  state = "output-available",
) {
  return {
    type: `tool-${toolName}`,
    toolCallId: `call-${Math.random().toString(36).slice(2, 8)}`,
    state,
    input,
    output,
  };
}

// Use minimumSavings=0 in most tests so we can test with small data.
// The minimum savings threshold is tested separately.
const NO_MIN = 0;

describe("pruneToolOutputs", () => {
  it("returns messages unchanged when total tool output tokens are within budget", () => {
    const messages: UIMessage[] = [
      makeUserMessage("hello"),
      makeAssistantMessage([
        { type: "text", text: "I'll run a command" },
        makeToolPart(
          "run_terminal_cmd",
          { stdout: "ok", exitCode: 0 },
          { command: "echo hi" },
        ),
      ]),
    ];

    const result = pruneToolOutputs(messages, 50_000, NO_MIN);

    expect(result.prunedCount).toBe(0);
    expect(result.tokensSaved).toBe(0);
    expect(result.messages).toBe(messages); // same reference
  });

  it("counts tool outputs containing tokenizer special tokens without throwing", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "file",
          {
            content:
              "Shell script contains a literal sentinel: <|im_start|>\nDone.",
          },
          { action: "read", path: "/tmp/script.sh" },
        ),
      ]),
    ];

    const result = pruneToolOutputs(messages, 50_000, NO_MIN);

    expect(result.prunedCount).toBe(0);
    expect(result.skipReason).toBe("within-budget");
    expect(result.messages).toBe(messages);
  });

  it("prunes oldest tool outputs first when over budget", () => {
    // Create a large output string that will exceed a small budget
    const largeOutput = "x".repeat(5000); // ~1250 tokens
    const smallOutput = "ok";

    const messages: UIMessage[] = [
      makeUserMessage("start"),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: largeOutput, exitCode: 0 },
            { command: "old-command" },
          ),
        ],
        "msg-old",
      ),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: smallOutput, exitCode: 0 },
            { command: "new-command" },
          ),
        ],
        "msg-new",
      ),
    ];

    // Budget small enough that the new output exhausts it,
    // so the old output gets pruned. "ok" output ≈ 10 tokens.
    const result = pruneToolOutputs(messages, 5, NO_MIN);

    expect(result.prunedCount).toBe(1);
    expect(result.tokensSaved).toBeGreaterThan(0);

    // The old message's tool output should be replaced with a placeholder
    const oldMsg = result.messages[1];
    const oldPart = oldMsg.parts[0] as any;
    expect(oldPart.output).toMatch(
      /^\[Terminal: ran 'old-command', exit code 0\]$/,
    );

    // The new message's tool output should be intact
    const newMsg = result.messages[2];
    const newPart = newMsg.parts[0] as any;
    expect(newPart.output).toEqual({ stdout: smallOutput, exitCode: 0 });
  });

  it("does not prune non-tool parts", () => {
    const messages: UIMessage[] = [
      makeUserMessage("a ".repeat(5000)), // large user message
      makeAssistantMessage([
        { type: "text", text: "b ".repeat(5000) }, // large text part
      ]),
    ];

    const result = pruneToolOutputs(messages, 100, NO_MIN);
    expect(result.prunedCount).toBe(0);
    expect(result.messages).toBe(messages);
  });

  it("does not prune tool parts that are not output-available", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "run_terminal_cmd",
          { stdout: "x".repeat(5000), exitCode: 0 },
          { command: "cmd" },
          "input-available",
        ),
      ]),
    ];

    const result = pruneToolOutputs(messages, 10, NO_MIN);
    expect(result.prunedCount).toBe(0);
  });

  it("does not prune tool parts with null output", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart("run_terminal_cmd", null, { command: "cmd" }),
      ]),
    ];

    const result = pruneToolOutputs(messages, 10, NO_MIN);
    expect(result.prunedCount).toBe(0);
  });

  it.each(["generate_image", "generate_video"])(
    "never prunes the %s deliverable reference",
    (toolName) => {
      const output = {
        ok: true,
        fileId: `file-${toolName}`,
        storageId: `storage-${toolName}`,
        url: `https://media.example/${"x".repeat(5_000)}`,
      };
      const messages: UIMessage[] = [
        makeAssistantMessage([makeToolPart(toolName, output, {})]),
      ];

      const result = pruneToolOutputs(messages, 0, NO_MIN);

      expect(result.prunedCount).toBe(0);
      expect((result.messages[0].parts[0] as any).output).toEqual(output);
    },
  );

  it("generates correct placeholder for file read tool", () => {
    const fileContent = Array.from({ length: 100 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "file",
          { content: fileContent },
          { action: "read", path: "/src/index.ts" },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);

    // File part should be pruned with placeholder
    const filePart = result.messages[0].parts[0] as any;
    expect(filePart.output).toMatch(
      /\[File: read \/src\/index\.ts \(100 lines\)\]/,
    );
  });

  it("generates correct placeholder for file edit tool", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "file",
          { success: true, diff: "x".repeat(5000) },
          { action: "edit", path: "/src/app.ts" },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    const filePart = result.messages[0].parts[0] as any;
    expect(filePart.output).toBe("[File: edit /src/app.ts]");
  });

  it("generates correct placeholder for match tool", () => {
    const matches = Array.from({ length: 50 }, (_, i) => ({
      file: `/src/file${i % 8}.ts`,
      line: i,
      content: "x".repeat(100),
    }));

    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart("match", matches, { pattern: "TODO" }),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    const matchPart = result.messages[0].parts[0] as any;
    expect(matchPart.output).toMatch(/\[Match: 50 results in/);
  });

  it("generates correct placeholder for web_search tool", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "web_search",
          {
            results: Array(10).fill({
              title: "r",
              url: "u",
              snippet: "s".repeat(500),
            }),
          },
          { query: "how to fix bug" },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    const searchPart = result.messages[0].parts[0] as any;
    expect(searchPart.output).toBe("[Search: 'how to fix bug']");
  });

  it("compacts rendered browser pages without retaining their full text", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "browse_url",
          {
            ok: true,
            url: "https://example.com/docs",
            text: "documentation ".repeat(1_000),
          },
          { url: "https://example.com/docs" },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    const browserPart = result.messages[0].parts[0] as any;
    expect(browserPart.output).toBe("[URL: opened https://example.com/docs]");
  });

  it("generates correct placeholder for unknown tools", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart("some_custom_tool", { data: "x".repeat(5000) }, {}),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    const part = result.messages[0].parts[0] as any;
    expect(part.output).toBe("[Tool: some_custom_tool completed]");
  });

  it("preserves input field on pruned parts", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "run_terminal_cmd",
          { stdout: "x".repeat(5000), exitCode: 0 },
          { command: "nmap -sV target" },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    const prunedPart = result.messages[0].parts[0] as any;
    expect(prunedPart.input).toEqual({ command: "nmap -sV target" });
  });

  it("does not mutate original messages", () => {
    const originalOutput = { stdout: "x".repeat(5000), exitCode: 0 };
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart("run_terminal_cmd", originalOutput, { command: "old" }),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "new", exitCode: 0 },
            { command: "new" },
          ),
        ],
        "msg-new",
      ),
    ];

    pruneToolOutputs(messages, 5, NO_MIN);

    // Original should be unchanged
    const origPart = messages[0].parts[0] as any;
    expect(origPart.output).toBe(originalOutput);
  });

  it("handles empty messages array", () => {
    const result = pruneToolOutputs([], 50_000, NO_MIN);
    expect(result.prunedCount).toBe(0);
    expect(result.messages).toEqual([]);
  });

  it("truncates long commands in placeholders", () => {
    const longCommand = "a".repeat(100);
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "run_terminal_cmd",
          { stdout: "x".repeat(5000), exitCode: 0 },
          { command: longCommand },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    const prunedPart = result.messages[0].parts[0] as any;
    expect(prunedPart.output).toContain("...");
    expect(prunedPart.output.length).toBeLessThan(120);
  });

  // --- Multiple tool parts in a single message ---

  it("prunes only old tool parts when multiple exist in one message", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage(
        [
          { type: "text", text: "Running two commands" },
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "x".repeat(5000), exitCode: 0 },
            { command: "first" },
          ),
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "y".repeat(5000), exitCode: 1 },
            { command: "second" },
          ),
        ],
        "msg-old",
      ),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "latest" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    expect(result.prunedCount).toBe(2);

    // Text part should be untouched
    const textPart = result.messages[0].parts[0] as any;
    expect(textPart.type).toBe("text");
    expect(textPart.text).toBe("Running two commands");

    // Both tool parts in the old message should be pruned
    const firstPart = result.messages[0].parts[1] as any;
    const secondPart = result.messages[0].parts[2] as any;
    expect(firstPart.output).toMatch(/\[Terminal:/);
    expect(secondPart.output).toMatch(/\[Terminal:/);
  });

  // --- output-error parts ---

  it("prunes output-error tool parts too", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "run_terminal_cmd",
          { stderr: "x".repeat(5000), exitCode: 1 },
          { command: "failing" },
          "output-error",
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    expect(result.prunedCount).toBe(1);
    const part = result.messages[0].parts[0] as any;
    expect(part.output).toMatch(/\[Terminal:/);
  });

  // --- Already-pruned detection ---

  it("skips already-pruned parts (string outputs)", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        // This was already pruned in a previous pass — output is a string placeholder
        makeToolPart("run_terminal_cmd", "[Terminal: ran 'old', exit code 0]", {
          command: "old",
        }),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    // The already-pruned part should not be counted or re-pruned
    expect(result.prunedCount).toBe(0);
  });

  // --- Protected tools ---

  it("never prunes protected tools (todo_write)", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "todo_write",
          { todos: Array(100).fill({ content: "task", status: "pending" }) },
          {},
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    const todoPart = result.messages[0].parts[0] as any;
    // Output should be the original object, not a placeholder
    expect(todoPart.output).toEqual(
      expect.objectContaining({ todos: expect.any(Array) }),
    );
  });

  it("never prunes protected tools (create_note, list_notes, update_note, delete_note)", () => {
    const protectedTools = [
      "create_note",
      "list_notes",
      "update_note",
      "delete_note",
    ];

    for (const toolName of protectedTools) {
      const messages: UIMessage[] = [
        makeAssistantMessage([
          makeToolPart(toolName, { data: "x".repeat(5000) }, {}),
        ]),
        makeAssistantMessage(
          [
            makeToolPart(
              "run_terminal_cmd",
              { stdout: "recent", exitCode: 0 },
              { command: "echo" },
            ),
          ],
          "msg-new",
        ),
      ];

      const result = pruneToolOutputs(messages, 5, NO_MIN);
      const part = result.messages[0].parts[0] as any;
      expect(part.output).toEqual({ data: "x".repeat(5000) });
    }
  });

  it("compacts old delegate_task results while preserving their decision summary", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "delegate_task",
          {
            ok: true,
            agent: { name: "Ada" },
            summary: "Keep the verification gate request-scoped.",
            findings: [{ detail: "x".repeat(5_000) }],
          },
          { name: "Ada", role: "reviewer" },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "ok", exitCode: 0 },
            { command: "echo" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    const delegatePart = result.messages[0].parts[0] as any;

    expect(result.prunedCount).toBe(1);
    expect(delegatePart.output).toBe(
      "[Subagent: Ada — Keep the verification gate request-scoped.]",
    );
  });

  // --- Minimum savings threshold ---

  it("skips pruning when token savings are below minimum threshold", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        // ~250 tokens of output — well below the 20K default minimum
        makeToolPart(
          "run_terminal_cmd",
          { stdout: "x".repeat(1000), exitCode: 0 },
          { command: "old" },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "new" },
          ),
        ],
        "msg-new",
      ),
    ];

    // Budget=5 would prune the old output, but minimum savings of 20K blocks it
    const result = pruneToolOutputs(messages, 5, 20_000);
    expect(result.prunedCount).toBe(0);
    expect(result.messages).toBe(messages);
  });

  it("prunes when token savings exceed minimum threshold", () => {
    // Use varied content that tokenizes to many tokens (repeated "x" compresses too well)
    const lines = Array.from(
      { length: 2000 },
      (_, i) =>
        `[line ${i}] Found vulnerability CVE-${2024 + (i % 5)}-${1000 + i} at endpoint /api/v${i % 3}/resource${i}`,
    ).join("\n");

    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "run_terminal_cmd",
          { stdout: lines, exitCode: 0 },
          { command: "old" },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "new" },
          ),
        ],
        "msg-new",
      ),
    ];

    // Use a moderate minimum that the varied content will exceed
    const result = pruneToolOutputs(messages, 5, 1_000);
    expect(result.prunedCount).toBe(1);
    expect(result.tokensSaved).toBeGreaterThan(1_000);
  });

  // --- Diagnostic fields ---

  it("returns skipReason 'no-tool-outputs' when no tool parts exist", () => {
    const messages: UIMessage[] = [
      makeUserMessage("hello"),
      makeAssistantMessage([{ type: "text", text: "hi" }]),
    ];

    const result = pruneToolOutputs(messages, 100, NO_MIN);
    expect(result.skipReason).toBe("no-tool-outputs");
    expect(result.toolOutputCount).toBe(0);
    expect(result.totalToolOutputTokens).toBe(0);
  });

  it("returns skipReason 'within-budget' when all outputs fit in budget", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "run_terminal_cmd",
          { stdout: "ok", exitCode: 0 },
          { command: "echo" },
        ),
      ]),
    ];

    const result = pruneToolOutputs(messages, 50_000, NO_MIN);
    expect(result.skipReason).toBe("within-budget");
    expect(result.toolOutputCount).toBe(1);
    expect(result.totalToolOutputTokens).toBeGreaterThan(0);
  });

  it("returns skipReason 'below-minimum-savings' when savings are too small", () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "run_terminal_cmd",
          { stdout: "x".repeat(1000), exitCode: 0 },
          { command: "old" },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "new" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, 20_000);
    expect(result.skipReason).toBe("below-minimum-savings");
    expect(result.toolOutputCount).toBe(2);
    expect(result.totalToolOutputTokens).toBeGreaterThan(0);
  });

  it("returns skipReason null and token totals when pruning occurs", () => {
    const largeOutput = "x".repeat(5000);
    const messages: UIMessage[] = [
      makeAssistantMessage([
        makeToolPart(
          "run_terminal_cmd",
          { stdout: largeOutput, exitCode: 0 },
          { command: "old" },
        ),
      ]),
      makeAssistantMessage(
        [
          makeToolPart(
            "run_terminal_cmd",
            { stdout: "recent", exitCode: 0 },
            { command: "new" },
          ),
        ],
        "msg-new",
      ),
    ];

    const result = pruneToolOutputs(messages, 5, NO_MIN);
    expect(result.skipReason).toBeNull();
    expect(result.prunedCount).toBe(1);
    expect(result.toolOutputCount).toBe(2);
    expect(result.totalToolOutputTokens).toBeGreaterThan(0);
    expect(result.tokensSaved).toBeGreaterThan(0);
  });
});

describe("compactMessageForStorage — evidence is offloaded, not destroyed", () => {
  const terminalPart = (toolCallId: string, text: string) => ({
    type: "data-terminal",
    id: `pty-${toolCallId}-${text.length}`,
    data: { terminal: text, toolCallId, action: "exec" },
  });

  it("folds streamed terminal parts into one evidence blob and removes them", () => {
    // Each emit is its own part with its own id, so one long command leaves
    // hundreds on a message. Nothing in the pipeline could shrink them, which
    // is why assistant messages kept approaching Convex's 1 MiB cap.
    const chunks = Array.from({ length: 200 }, (_, index) =>
      terminalPart("call-1", `line ${index} ${"x".repeat(200)}\n`),
    );
    const message = makeAssistantMessage([
      { type: "text", text: "ran the build" },
      ...chunks,
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 5_000,
    });

    expect(result.compacted).toBe(true);
    expect(result.strippedTerminalParts).toBe(200);
    expect(
      result.message.parts.some((part: any) => part.type === "data-terminal"),
    ).toBe(false);
    expect(result.afterSizeBytes).toBeLessThan(result.beforeSizeBytes);

    // The output is preserved in one piece, in order.
    expect(result.offloaded).toHaveLength(1);
    const evidence = result.offloaded[0];
    expect(evidence.kind).toBe("terminal_output");
    expect(evidence.toolCallId).toBe("call-1");
    expect(evidence.content).toContain("line 0 ");
    expect(evidence.content).toContain("line 199 ");
  });

  it("keeps each tool call's streamed output separate", () => {
    const message = makeAssistantMessage([
      terminalPart("call-a", "a".repeat(4000)),
      terminalPart("call-b", "b".repeat(4000)),
    ]);

    const result = compactMessageForStorage(message, { softLimitBytes: 2_000 });

    expect(result.offloaded).toHaveLength(2);
    const byId = Object.fromEntries(
      result.offloaded.map((item) => [item.toolCallId, item.content]),
    );
    expect(byId["call-a"]).toBe("a".repeat(4000));
    expect(byId["call-b"]).toBe("b".repeat(4000));
  });

  it("hands back the full tool output it replaced with a placeholder", () => {
    // Pruning overwrites structured output with a one-line placeholder. The
    // content it overwrote has to come back out, or the run's evidence is gone
    // the moment the message is read again.
    const message = makeAssistantMessage([
      makeToolPart(
        "run_terminal_cmd",
        {
          result: {
            exitCode: 1,
            output: "compilation failed\n".repeat(2000),
            durationMs: 4200,
            startedAt: 1000,
            endedAt: 5200,
          },
        },
        { command: "npm run build" },
      ),
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 1_000,
      toolOutputTokenBudget: 0,
    });

    expect(result.prunedCount).toBeGreaterThan(0);
    const offloadedTerminal = result.offloaded.find(
      (item) => item.toolName === "run_terminal_cmd",
    );
    expect(offloadedTerminal).toBeDefined();
    expect(offloadedTerminal!.content).toContain("compilation failed");
    // The evidence keeps what the placeholder cannot carry.
    expect(offloadedTerminal!.command).toBe("npm run build");
    expect(offloadedTerminal!.exitCode).toBe(1);
    expect(offloadedTerminal!.durationMs).toBe(4200);
  });

  it("offloads nothing when the message is small enough to store as-is", () => {
    const message = makeAssistantMessage([
      { type: "text", text: "short" },
      terminalPart("call-1", "tiny"),
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 100_000,
    });

    expect(result.compacted).toBe(false);
    expect(result.offloaded).toEqual([]);
    expect(result.strippedTerminalParts).toBe(0);
  });
});

describe("compactMessageForStorage", () => {
  it("leaves small assistant messages unchanged", () => {
    const message = makeAssistantMessage([
      { type: "text", text: "small answer" },
      makeToolPart(
        "file",
        { content: "ok", originalContent: "ok" },
        { action: "read", path: "/tmp/a.txt" },
      ),
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 10_000,
    });

    expect(result.compacted).toBe(false);
    expect(result.message).toBe(message);
    expect(result.prunedCount).toBe(0);
  });

  it("strips bulky UI-only file fields before storage", () => {
    const message = makeAssistantMessage([
      makeToolPart(
        "file",
        {
          content: "latest content",
          originalContent: "x".repeat(5000),
          modifiedContent: "y".repeat(5000),
        },
        { action: "edit", path: "/tmp/a.txt" },
      ),
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 1000,
      toolOutputTokenBudget: 10_000,
    });

    const part = result.message.parts[0] as any;
    expect(result.compacted).toBe(true);
    expect(result.strippedUiOnlyFields).toBe(true);
    expect(part.output).toEqual({ content: "latest content" });
    expect(result.afterSizeBytes).toBeLessThan(result.beforeSizeBytes);
  });

  it("prunes old tool outputs when stripped parts are still too large", () => {
    const message = makeAssistantMessage([
      makeToolPart(
        "file",
        { content: "old ".repeat(2000) },
        { action: "read", path: "/tmp/old.txt" },
      ),
      makeToolPart(
        "file",
        { content: "new ".repeat(2000) },
        { action: "read", path: "/tmp/new.txt" },
      ),
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 1000,
      toolOutputTokenBudget: 100,
    });

    expect(result.compacted).toBe(true);
    expect(result.prunedCount).toBeGreaterThan(0);
    expect(estimateSerializedSizeBytes(result.message.parts)).toBeLessThan(
      estimateSerializedSizeBytes(message.parts),
    );
  });

  it("compacts oversized reasoning and storage-only status parts", () => {
    const message = makeAssistantMessage([
      { type: "step-start" },
      { type: "data-summarization", data: { status: "completed" } },
      { type: "reasoning", text: "old ".repeat(20_000), state: "done" },
      { type: "text", text: "final answer" },
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 1_000,
      toolOutputTokenBudget: 10_000,
    });

    expect(result.compacted).toBe(true);
    expect(
      result.message.parts.some((part) => part.type === "step-start"),
    ).toBe(false);
    expect(
      result.message.parts.some((part) => part.type === "data-summarization"),
    ).toBe(false);
    expect(estimateSerializedSizeBytes(result.message.parts)).toBeLessThan(
      estimateSerializedSizeBytes(message.parts),
    );
    expect(result.message.parts.at(-1)).toEqual({
      type: "text",
      text: "final answer",
    });
  });

  it("does not compact user messages", () => {
    const message = makeUserMessage("x".repeat(5000));

    const result = compactMessageForStorage(message, { softLimitBytes: 100 });

    expect(result.compacted).toBe(false);
    expect(result.message).toBe(message);
  });
});

// ---------------------------------------------------------------------------
// pruneModelMessages (ModelMessage-level pruning for agentic loop)
// ---------------------------------------------------------------------------

// Helpers for ModelMessage format
function makeAssistantModelMsg(
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }>,
) {
  return {
    role: "assistant",
    content: toolCalls.map((tc) => ({
      type: "tool-call",
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      args: tc.args,
    })),
  };
}

function makeToolModelMsg(
  results: Array<{ toolCallId: string; toolName: string; output: unknown }>,
) {
  return {
    role: "tool",
    content: results.map((r) => ({
      type: "tool-result",
      toolCallId: r.toolCallId,
      toolName: r.toolName,
      output: r.output,
    })),
  };
}

describe("pruneModelMessages", () => {
  it("returns messages unchanged when within budget", () => {
    const messages = [
      makeAssistantModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          args: { command: "echo hi" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          output: { stdout: "hi", exitCode: 0 },
        },
      ]),
    ];

    const result = pruneModelMessages(messages, 50_000, NO_MIN);
    expect(result.prunedCount).toBe(0);
    expect(result.skipReason).toBe("within-budget");
    expect(result.messages).toBe(messages);
  });

  it("counts model tool results containing tokenizer special tokens without throwing", () => {
    const messages = [
      makeAssistantModelMsg([
        {
          toolCallId: "c1",
          toolName: "file",
          args: { action: "read", path: "/tmp/upgrade_model.sh" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c1",
          toolName: "file",
          output: {
            content:
              "Template text includes reserved model syntax: <|im_start|>system",
          },
        },
      ]),
    ];

    const result = pruneModelMessages(messages, 50_000, NO_MIN);

    expect(result.prunedCount).toBe(0);
    expect(result.skipReason).toBe("within-budget");
    expect(result.messages).toBe(messages);
  });

  it("prunes oldest tool results first when over budget", () => {
    const messages = [
      { role: "user", content: "start" },
      makeAssistantModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          args: { command: "old-cmd" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          output: { stdout: "x".repeat(5000), exitCode: 0 },
        },
      ]),
      makeAssistantModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          args: { command: "new-cmd" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          output: { stdout: "ok", exitCode: 0 },
        },
      ]),
    ];

    const result = pruneModelMessages(messages, 5, NO_MIN);
    expect(result.prunedCount).toBe(1);
    expect(result.tokensSaved).toBeGreaterThan(0);

    // Old tool result should be placeholder
    const oldToolMsg = result.messages[2] as any;
    expect(oldToolMsg.content[0].output).toMatch(
      /\[Terminal: ran 'old-cmd', exit code 0\]/,
    );

    // New tool result should be intact
    const newToolMsg = result.messages[4] as any;
    expect(newToolMsg.content[0].output).toEqual({ stdout: "ok", exitCode: 0 });
  });

  it("uses tool-call args for rich placeholders", () => {
    const messages = [
      makeAssistantModelMsg([
        {
          toolCallId: "c1",
          toolName: "file",
          args: { action: "read", path: "/src/index.ts" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c1",
          toolName: "file",
          output: {
            content: Array.from({ length: 50 }, (_, i) => `line ${i}`).join(
              "\n",
            ),
          },
        },
      ]),
      makeAssistantModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          args: { command: "echo" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          output: { stdout: "ok", exitCode: 0 },
        },
      ]),
    ];

    const result = pruneModelMessages(messages, 5, NO_MIN);
    const filePart = (result.messages[1] as any).content[0];
    expect(filePart.output).toMatch(
      /\[File: read \/src\/index\.ts \(50 lines\)\]/,
    );
  });

  it("supports AI SDK v6 tool-call input and structured tool-result output", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "delegate-old",
            toolName: "delegate_task",
            input: { name: "Grace", role: "debugger" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "delegate-old",
            toolName: "delegate_task",
            output: {
              type: "json",
              value: {
                ok: true,
                agent: { name: "Grace" },
                summary: "The abort signal is wired correctly.",
                findings: [{ detail: "x".repeat(5_000) }],
              },
            },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "terminal-new",
            toolName: "run_terminal_cmd",
            input: { command: "echo ok" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "terminal-new",
            toolName: "run_terminal_cmd",
            output: { type: "json", value: { stdout: "ok", exitCode: 0 } },
          },
        ],
      },
    ];

    const result = pruneModelMessages(messages, 5, NO_MIN);
    const delegateOutput = (result.messages[1] as any).content[0].output;

    expect(result.prunedCount).toBe(1);
    expect(delegateOutput).toEqual({
      type: "text",
      value: "[Subagent: Grace — The abort signal is wired correctly.]",
    });
  });

  it("does not prune protected tools", () => {
    const messages = [
      makeAssistantModelMsg([
        { toolCallId: "c1", toolName: "todo_write", args: {} },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c1",
          toolName: "todo_write",
          output: { todos: Array(100).fill({ content: "task" }) },
        },
      ]),
      makeAssistantModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          args: { command: "echo" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          output: { stdout: "ok", exitCode: 0 },
        },
      ]),
    ];

    const result = pruneModelMessages(messages, 5, NO_MIN);
    const todoPart = (result.messages[1] as any).content[0];
    expect(todoPart.output).toEqual(
      expect.objectContaining({ todos: expect.any(Array) }),
    );
  });

  it("skips already-pruned string outputs", () => {
    const messages = [
      makeAssistantModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          args: { command: "old" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          output: "[Terminal: ran 'old', exit code 0]",
        },
      ]),
      makeAssistantModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          args: { command: "echo" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          output: { stdout: "ok", exitCode: 0 },
        },
      ]),
    ];

    const result = pruneModelMessages(messages, 5, NO_MIN);
    expect(result.prunedCount).toBe(0);
  });

  it("does not mutate original messages", () => {
    const originalOutput = { stdout: "x".repeat(5000), exitCode: 0 };
    const messages = [
      makeAssistantModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          args: { command: "old" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          output: originalOutput,
        },
      ]),
      makeAssistantModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          args: { command: "new" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          output: { stdout: "ok", exitCode: 0 },
        },
      ]),
    ];

    pruneModelMessages(messages, 5, NO_MIN);
    const origPart = (messages[1] as any).content[0];
    expect(origPart.output).toBe(originalOutput);
  });

  it("skips non-tool messages", () => {
    const messages = [
      { role: "user", content: "a ".repeat(5000) },
      {
        role: "assistant",
        content: [{ type: "text", text: "b ".repeat(5000) }],
      },
    ];

    const result = pruneModelMessages(messages, 5, NO_MIN);
    expect(result.prunedCount).toBe(0);
    expect(result.skipReason).toBe("no-tool-outputs");
  });

  it("respects minimum savings threshold", () => {
    const messages = [
      makeAssistantModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          args: { command: "old" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          output: { stdout: "x".repeat(1000), exitCode: 0 },
        },
      ]),
      makeAssistantModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          args: { command: "new" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          output: { stdout: "ok", exitCode: 0 },
        },
      ]),
    ];

    const result = pruneModelMessages(messages, 5, 20_000);
    expect(result.prunedCount).toBe(0);
    expect(result.skipReason).toBe("below-minimum-savings");
  });

  it("returns diagnostic fields on pruning", () => {
    const messages = [
      makeAssistantModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          args: { command: "old" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c1",
          toolName: "run_terminal_cmd",
          output: { stdout: "x".repeat(5000), exitCode: 0 },
        },
      ]),
      makeAssistantModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          args: { command: "new" },
        },
      ]),
      makeToolModelMsg([
        {
          toolCallId: "c2",
          toolName: "run_terminal_cmd",
          output: { stdout: "ok", exitCode: 0 },
        },
      ]),
    ];

    const result = pruneModelMessages(messages, 5, NO_MIN);
    expect(result.skipReason).toBeNull();
    expect(result.prunedCount).toBe(1);
    expect(result.toolOutputCount).toBe(2);
    expect(result.totalToolOutputTokens).toBeGreaterThan(0);
    expect(result.tokensSaved).toBeGreaterThan(0);
  });
});

describe("filterEmptyAssistantMessages", () => {
  it("removes assistant messages with empty content array", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [] },
      { role: "user", content: [{ type: "text", text: "world" }] },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role !== "assistant")).toBe(true);
  });

  it("removes assistant messages with only whitespace text parts", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "   " }] },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(1);
  });

  it("keeps assistant messages with tool-call content", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc1", toolName: "read", args: {} },
        ],
      },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(1);
  });

  it("keeps assistant messages with non-empty text", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(1);
  });

  it("keeps non-assistant messages unchanged", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "tc1" }] },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(2);
  });

  it("handles string content gracefully", () => {
    const messages = [{ role: "assistant", content: "some text" }];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(1);
  });

  it("preserves message ordering after filtering", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
      { role: "user", content: [{ type: "text", text: "c" }] },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toEqual([
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
      { role: "user", content: [{ type: "text", text: "c" }] },
    ]);
  });

  it("keeps assistant with empty text alongside tool-call", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "tool-call", toolCallId: "tc1", toolName: "read", args: {} },
        ],
      },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(1);
  });

  it("removes assistant with empty string text (not just whitespace)", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "" }] },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(0);
  });

  it("removes assistant with only reasoning parts", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "thinking about this..." }],
      },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(0);
  });

  it("removes assistant with only redacted-reasoning parts", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "redacted-reasoning", data: "abc" }],
      },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(0);
  });

  it("keeps assistant with reasoning and text", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking..." },
          { type: "text", text: "Here is my answer" },
        ],
      },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(1);
  });

  it("keeps assistant with reasoning and tool-call", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "I should call this tool" },
          { type: "tool-call", toolCallId: "tc1", toolName: "read", args: {} },
        ],
      },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(1);
  });

  it("does not break assistant→tool pairing when assistant has tool calls", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc1", toolName: "read", args: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "read",
            output: "file contents",
          },
        ],
      },
      { role: "assistant", content: [] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];
    const result = filterEmptyAssistantMessages(messages);
    expect(result).toHaveLength(4);
    expect(result[1]).toEqual(messages[1]); // assistant with tool-call kept
    expect(result[2]).toEqual(messages[2]); // tool result kept
    expect(result[3]).toEqual(messages[4]); // final assistant kept
  });
});

describe("repairAnthropicModelMessages", () => {
  it("preserves useful trailing assistant text by appending a user continuation", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "build this" }] },
      { role: "assistant", content: [{ type: "text", text: "half answer" }] },
    ];

    expect(repairAnthropicModelMessages(messages)).toEqual([
      ...messages,
      {
        role: "user",
        content:
          "Continue from the previous assistant message. Do not repeat completed work.",
      },
    ]);
  });

  it("trims a trailing assistant with no useful provider-visible content", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "build this" }] },
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "thinking..." }],
      },
    ];

    expect(repairAnthropicModelMessages(messages)).toEqual([messages[0]]);
  });

  it("trims a trailing assistant with a dangling tool call", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "read the file" }] },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc1", toolName: "read", args: {} },
        ],
      },
    ];

    expect(repairAnthropicModelMessages(messages)).toEqual([messages[0]]);
  });

  it("leaves conversations ending in user or tool messages unchanged", () => {
    const userEnding = [
      { role: "assistant", content: [{ type: "text", text: "done" }] },
      { role: "user", content: [{ type: "text", text: "continue" }] },
    ];
    const toolEnding = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc1", toolName: "read", args: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "read",
            output: "contents",
          },
        ],
      },
    ];

    expect(repairAnthropicModelMessages(userEnding)).toBe(userEnding);
    expect(repairAnthropicModelMessages(toolEnding)).toBe(toolEnding);
  });
});

/*
 * The production failure this pass exists for.
 *
 * A Build run wrote many files, and the `file` tool carries each whole file
 * body in its INPUT. Every earlier pass trims OUTPUT, so the cascade ran out of
 * moves and returned the message anyway: prod logged 2,342,009 bytes reduced to
 * 1,992,384 — still roughly twice the 1MB document limit — and the database
 * refused it, taking 58 minutes of finished work with it.
 */
describe("compactMessageForStorage — tool inputs are the last resort", () => {
  const bigFileWrite = (path: string, size: number) =>
    makeToolPart(
      "file",
      { content: "written" },
      { action: "write", path, text: "x".repeat(size) },
    );

  it("excerpts tool inputs when trimming outputs cannot get under the limit", () => {
    const message = makeAssistantMessage([
      bigFileWrite("/app/a.tsx", 60_000),
      bigFileWrite("/app/b.tsx", 60_000),
      bigFileWrite("/app/c.tsx", 60_000),
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 20_000,
      toolOutputTokenBudget: 0,
    });

    expect(result.fitsSoftLimit).toBe(true);
    expect(result.afterSizeBytes).toBeLessThanOrEqual(20_000);
    expect(result.excerptedInputs).toBeGreaterThan(0);
  });

  it("keeps the original input as offloaded evidence rather than destroying it", () => {
    const original = "x".repeat(60_000);
    const message = makeAssistantMessage([
      makeToolPart(
        "file",
        { content: "written" },
        { action: "write", path: "/app/a.tsx", text: original },
      ),
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 5_000,
      toolOutputTokenBudget: 0,
    });

    const offloadedInput = result.offloaded.find((e) => e.kind === "tool_input");
    expect(offloadedInput?.content).toBe(original);
    expect(offloadedInput?.toolName).toBe("file");
  });

  it("leaves the rest of the input intact — only the bulky string is excerpted", () => {
    const message = makeAssistantMessage([
      bigFileWrite("/app/a.tsx", 60_000),
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 5_000,
      toolOutputTokenBudget: 0,
    });

    const input = (result.message.parts[0] as any).input;
    expect(input.action).toBe("write");
    expect(input.path).toBe("/app/a.tsx");
    expect(input.text).toContain("characters moved to run evidence");
    expect(input.text.length).toBeLessThan(5_000);
  });

  // Largest-first is what keeps this gentle: one big file usually buys the
  // whole budget, and the run's smaller inputs are left alone.
  it("stops as soon as it fits, leaving smaller inputs whole", () => {
    const small = "s".repeat(3_000);
    const message = makeAssistantMessage([
      bigFileWrite("/app/huge.tsx", 400_000),
      makeToolPart(
        "file",
        { content: "written" },
        { action: "write", path: "/app/small.tsx", text: small },
      ),
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 50_000,
      toolOutputTokenBudget: 0,
    });

    expect(result.fitsSoftLimit).toBe(true);
    expect(result.excerptedInputs).toBe(1);
    expect((result.message.parts[1] as any).input.text).toBe(small);
  });

  it("nests into arrays, so an edit's find/replace halves are reachable", () => {
    const body = "y".repeat(80_000);
    const message = makeAssistantMessage([
      makeToolPart(
        "file",
        { content: "edited" },
        {
          action: "edit",
          path: "/app/a.tsx",
          edits: [{ find: body, replace: body }],
        },
      ),
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 10_000,
      toolOutputTokenBudget: 0,
    });

    expect(result.fitsSoftLimit).toBe(true);
    const edit = (result.message.parts[0] as any).input.edits[0];
    expect(edit.find).toContain("characters moved to run evidence");
  });

  // Honest reporting matters more than a green flag: a caller logs this to
  // catch a message that is still too big BEFORE the database refuses it.
  it("uses an archive reference when inline prose cannot fit", () => {
    const message = makeAssistantMessage([
      { type: "text", text: "z".repeat(60_000) },
    ]);

    const result = compactMessageForStorage(message, {
      softLimitBytes: 1_000,
      toolOutputTokenBudget: 0,
    });

    expect(result.fitsSoftLimit).toBe(true);
  });
});

describe("storage overflow guard", () => {
  it("bounds large string results that token pruning deliberately skips", () => {
    const original = makeAssistantMessage([
      makeToolPart("get_terminal_files", "ğ".repeat(560_000)),
      { type: "text", text: "Completed the requested changes." },
    ]);
    const result = compactMessageForStorage(original);
    expect(result.fitsSoftLimit).toBe(true);
    expect(result.afterSizeBytes).toBeLessThan(850 * 1024);
    expect(result.message.parts).toContainEqual(original.parts[1]);
    expect((original.parts[0] as any).output).toHaveLength(560_000);
  });
  it("bounds oversized prose too, including the duplicated searchable content", () => {
    const result = compactMessageForStorage(makeAssistantMessage([
      { type: "text", text: "x".repeat(900_000) },
    ]));
    expect(result.fitsSoftLimit).toBe(true);
    const texts = result.message.parts.filter(p => p.type === "text").map(p => (p as any).text).join("\n");
    expect(estimateSerializedSizeBytes({parts: result.message.parts, content: texts})).toBeLessThan(950 * 1024);
  });
});
