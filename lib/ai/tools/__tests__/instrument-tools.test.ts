import { TRUNCATION_MESSAGE } from "@/lib/token-utils";
import { createAgentRunTelemetry } from "@/lib/telemetry/agent-run-telemetry";
import {
  classifyToolError,
  instrumentToolSet,
  type ToolCallEvent,
} from "../utils/instrument-tools";

function makeClock(ticks: number[]) {
  let i = 0;
  return () => {
    const value = ticks[Math.min(i, ticks.length - 1)];
    i += 1;
    return value;
  };
}

function collect() {
  const events: ToolCallEvent[] = [];
  return { events, report: (event: ToolCallEvent) => events.push(event) };
}

const callOptions = { toolCallId: "call_1", messages: [] } as const;

describe("production tool outcome envelopes", () => {
  it.each([
    [
      "run_terminal_cmd",
      { result: { exitCode: 127, error: "command not found" } },
      "not_found",
    ],
    [
      "run_terminal_cmd",
      { result: { exitCode: 2, output: "private compiler output" } },
      "exit_nonzero",
    ],
    [
      "run_terminal_cmd",
      { result: { exited: { exitCode: 1 }, output: "private output" } },
      "exit_nonzero",
    ],
    [
      "run_terminal_cmd",
      { result: { exitCode: 130, aborted: true } },
      "aborted",
    ],
    [
      "run_terminal_cmd",
      {
        result: {
          exitCode: null,
          outcome: "unknown",
          error: "private diagnostic",
        },
      },
      "unconfirmed",
    ],
    [
      "mcp_browserbase_start",
      "Tool error: MCP tool call failed (Error).",
      "unknown",
    ],
    [
      "mcp_browserbase_start",
      {
        isError: true,
        content: [{ type: "text", text: "private diagnostic" }],
      },
      "unknown",
    ],
    [
      "mcp_browserbase_start",
      {
        isError: true,
        code: "mcp_call_unconfirmed",
        executionStatus: "unconfirmed",
        retrySafe: false,
      },
      "unconfirmed",
    ],
  ])(
    "reports %s outcome without altering or replaying it (%#)",
    async (toolName, result, errorClass) => {
      const { events, report } = collect();
      const execute = jest.fn(async () => result);
      const tools = instrumentToolSet(
        { [toolName as string]: { execute } },
        report,
      );
      expect(await tools[toolName as string].execute({}, callOptions)).toBe(
        result,
      );
      expect(execute).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ ok: false, errorClass });
      expect(JSON.stringify(events)).not.toContain("private");
    },
  );

  it.each([
    [
      "run_terminal_cmd",
      {
        result: {
          exitCode: 0,
          output: "Error: expected failure in test fixture",
        },
      },
    ],
    [
      "run_terminal_cmd",
      { result: { pid: 42, output: "Background process started" } },
    ],
    ["read_file", { result: { exitCode: 1, error: "sample file content" } }],
    [
      "mcp_read_file",
      {
        isError: false,
        content: [{ type: "text", text: "Tool error: documentation example" }],
      },
    ],
  ])(
    "does not infer failure from tool content or a background receipt (%#)",
    async (toolName, result) => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { [toolName as string]: { execute: async () => result } },
        report,
      );
      expect(await tools[toolName as string].execute({}, callOptions)).toBe(
        result,
      );
      expect(events[0]).toMatchObject({ ok: true });
      expect(events[0].errorClass).toBeUndefined();
    },
  );

  it("aggregates terminal failures, MCP errors and unconfirmed calls separately", async () => {
    const event = jest.fn();
    const telemetry = createAgentRunTelemetry({
      runId: "test-run",
      chatId: "test-chat",
      userId: "test-user",
      model: "test-model",
      endpoint: "/api/agent-long",
      emitter: { event },
    });
    const terminalResults = [
      { result: { exitCode: 127 } },
      { result: { exitCode: 2 } },
      { result: { exitCode: 0 } },
      { result: { pid: 42 } },
      {
        result: { exitCode: null, outcome: "unknown", error: "private-output" },
      },
    ];
    const tools = instrumentToolSet(
      {
        run_terminal_cmd: { execute: async () => terminalResults.shift() },
        mcp_browserbase_start: { execute: async () => ({ isError: true }) },
      },
      telemetry.onToolCall,
    );
    for (let i = 0; i < 5; i++)
      await tools.run_terminal_cmd.execute({}, callOptions);
    await tools.mcp_browserbase_start.execute({}, callOptions);
    expect(telemetry.snapshot()).toMatchObject({
      tool_calls: 6,
      tool_errors: 3,
      tool_unconfirmed: 1,
      tools: {
        run_terminal_cmd: { calls: 5, errors: 2, unconfirmed: 1 },
        mcp_browserbase_start: { calls: 1, errors: 1 },
      },
    });
    expect(event).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(event.mock.calls)).not.toContain("private-output");
  });
});

describe("instrumentToolSet", () => {
  it("preserves the return value of a sync execute", () => {
    const { events, report } = collect();
    const tools = instrumentToolSet(
      { echo: { description: "d", execute: (input: unknown) => input } },
      report,
    );
    const value = { hello: "world" };
    expect(tools.echo.execute(value, callOptions)).toBe(value);
    expect(events).toHaveLength(1);
    expect(events[0].ok).toBe(true);
    expect(events[0].toolName).toBe("echo");
    expect(events[0].toolCallId).toBe("call_1");
  });

  it("preserves the resolved value of an async execute", async () => {
    const { events, report } = collect();
    const tools = instrumentToolSet(
      { slow: { execute: async () => "done" } },
      report,
    );
    await expect(tools.slow.execute({}, callOptions)).resolves.toBe("done");
    expect(events).toHaveLength(1);
    expect(events[0].ok).toBe(true);
  });

  it("keeps every other property of the tool object", () => {
    const inputSchema = { type: "object" };
    const toModelOutput = () => ({ type: "text", value: "" });
    const tools = instrumentToolSet(
      {
        t: {
          description: "desc",
          inputSchema,
          toModelOutput,
          execute: () => 1,
        },
      },
      () => {},
    );
    expect(tools.t.description).toBe("desc");
    expect(tools.t.inputSchema).toBe(inputSchema);
    expect(tools.t.toModelOutput).toBe(toModelOutput);
  });

  it("returns tools without execute untouched and by the same reference", () => {
    const providerTool = { description: "provider-defined", type: "provider" };
    const { events, report } = collect();
    const tools = instrumentToolSet(
      { provider: providerTool, real: { execute: () => 1 } },
      report,
    );
    expect(tools.provider).toBe(providerTool);
    expect(tools.real).not.toBe(providerTool);
    expect(events).toHaveLength(0);
  });

  it("measures duration with the injected clock", async () => {
    const { events, report } = collect();
    const tools = instrumentToolSet(
      { t: { execute: async () => "ok" } },
      report,
      { now: makeClock([1000, 1250]) },
    );
    await tools.t.execute({}, callOptions);
    expect(events[0].startedAt).toBe(1000);
    expect(events[0].durationMs).toBe(250);
  });

  describe("error shapes", () => {
    it("thrown timeout -> ok=false, timeout, and rethrows after reporting", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        {
          t: {
            execute: async () => {
              throw new Error("Command timed out after 30s");
            },
          },
        },
        report,
      );
      await expect(tools.t.execute({}, callOptions)).rejects.toThrow(
        "timed out",
      );
      expect(events).toHaveLength(1);
      expect(events[0].ok).toBe(false);
      expect(events[0].errorClass).toBe("timeout");
    });

    it("sync throw is reported then rethrown", () => {
      const { events, report } = collect();
      const boom = new Error("ETIMEDOUT connecting");
      const tools = instrumentToolSet(
        {
          t: {
            execute: () => {
              throw boom;
            },
          },
        },
        report,
      );
      expect(() => tools.t.execute({}, callOptions)).toThrow(boom);
      expect(events[0].ok).toBe(false);
      expect(events[0].errorClass).toBe("timeout");
    });

    it("{ error: '...' } output -> ok=false", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => ({ error: "something broke" }) } },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].ok).toBe(false);
      expect(events[0].errorClass).toBe("unknown");
    });

    it("{ success: false } output -> ok=false", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => ({ success: false }) } },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].ok).toBe(false);
      expect(events[0].errorClass).toBe("unknown");
    });

    it("{ exitCode: 1 } output -> exit_nonzero", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => ({ exitCode: 1, output: "boom" }) } },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].ok).toBe(false);
      expect(events[0].errorClass).toBe("exit_nonzero");
    });

    it("{ exitCode: 0 } output stays ok", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => ({ exitCode: 0, output: "fine" }) } },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].ok).toBe(true);
      expect(events[0].errorClass).toBeUndefined();
    });

    it("ENOENT -> not_found", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        {
          t: {
            execute: async () => ({
              exitCode: 1,
              error: "ENOENT: no such file or directory, open '/x'",
            }),
          },
        },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].errorClass).toBe("not_found");
    });

    it("AbortError -> aborted", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        {
          t: {
            execute: async () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              throw err;
            },
          },
        },
        report,
      );
      await expect(tools.t.execute({}, callOptions)).rejects.toThrow();
      expect(events[0].errorClass).toBe("aborted");
    });

    it("an aborted abortSignal classifies a failure as aborted", async () => {
      const { events, report } = collect();
      const controller = new AbortController();
      const tools = instrumentToolSet(
        {
          t: {
            execute: async () => {
              controller.abort();
              throw new Error("stream closed");
            },
          },
        },
        report,
      );
      await expect(
        tools.t.execute({}, { ...callOptions, abortSignal: controller.signal }),
      ).rejects.toThrow();
      expect(events[0].errorClass).toBe("aborted");
    });

    it("string output starting with 'Error' -> ok=false", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => "Error: sandbox is not running" } },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].ok).toBe(false);
      expect(events[0].errorClass).toBe("sandbox");
    });
  });

  describe("truncated", () => {
    it("is true when a string output contains the marker", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => `head${TRUNCATION_MESSAGE}tail` } },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].truncated).toBe(true);
    });

    it("is true when { output } contains the marker", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        {
          t: {
            execute: async () => ({
              exitCode: 0,
              output: `a${TRUNCATION_MESSAGE}b`,
            }),
          },
        },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].truncated).toBe(true);
    });

    it("is false otherwise", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => ({ output: "short" }) } },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].truncated).toBe(false);
    });
  });

  describe("inputHash", () => {
    it("is deterministic regardless of key order and stable across calls", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => "ok" } },
        report,
      );
      await tools.t.execute(
        { a: 1, b: { y: 2, x: [1, { q: 1, p: 2 }] } },
        callOptions,
      );
      await tools.t.execute(
        { b: { x: [1, { p: 2, q: 1 }], y: 2 }, a: 1 },
        callOptions,
      );
      await tools.t.execute({ a: 2 }, callOptions);
      expect(events[0].inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(events[0].inputHash).toBe(events[1].inputHash);
      expect(events[2].inputHash).not.toBe(events[0].inputHash);
    });

    it("is undefined for undefined input and for circular input", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => "ok" } },
        report,
      );
      await tools.t.execute(undefined, callOptions);
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      await tools.t.execute(circular, callOptions);
      expect(events[0].inputHash).toBeUndefined();
      expect(events[1].inputHash).toBeUndefined();
    });
  });

  describe("outputBytes", () => {
    it("measures utf8 bytes of a string output", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => "héllo" } },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].outputBytes).toBe(Buffer.byteLength("héllo", "utf8"));
    });

    it("measures the output field of an object result", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => ({ exitCode: 0, output: "abcd" }) } },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].outputBytes).toBe(4);
    });

    it("is undefined for objects with no string payload field", async () => {
      const { events, report } = collect();
      const tools = instrumentToolSet(
        { t: { execute: async () => ({ items: [1, 2, 3] }) } },
        report,
      );
      await tools.t.execute({}, callOptions);
      expect(events[0].outputBytes).toBeUndefined();
    });
  });

  it("never leaks input, output, or error text into the event", async () => {
    const { events, report } = collect();
    const INPUT_SENTINEL = "SECRET_INPUT_9f8e7d";
    const OUTPUT_SENTINEL = "SECRET_OUTPUT_1a2b3c";
    const ERROR_SENTINEL = "SECRET_ERROR_4d5e6f";
    const tools = instrumentToolSet(
      {
        ok: { execute: async () => ({ output: OUTPUT_SENTINEL }) },
        bad: {
          execute: async () => {
            throw new Error(`timed out ${ERROR_SENTINEL}`);
          },
        },
      },
      report,
    );
    await tools.ok.execute({ token: INPUT_SENTINEL }, callOptions);
    await expect(
      tools.bad.execute({ token: INPUT_SENTINEL }, callOptions),
    ).rejects.toThrow();
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(INPUT_SENTINEL);
    expect(serialized).not.toContain(OUTPUT_SENTINEL);
    expect(serialized).not.toContain(ERROR_SENTINEL);
    expect(Object.keys(events[0]).sort()).toEqual(
      [
        "durationMs",
        "inputHash",
        "ok",
        "outputBytes",
        "startedAt",
        "toolCallId",
        "toolName",
        "truncated",
      ].sort(),
    );
  });

  it("a throwing reporter does not break the tool", async () => {
    const tools = instrumentToolSet(
      { t: { execute: async () => "fine" } },
      () => {
        throw new Error("reporter exploded");
      },
    );
    await expect(tools.t.execute({}, callOptions)).resolves.toBe("fine");
  });
});

describe("classifyToolError", () => {
  it("returns undefined when there is nothing to classify", () => {
    expect(classifyToolError(undefined, { exitCode: 0 })).toBeUndefined();
    expect(classifyToolError(undefined, "all good")).toBeUndefined();
  });

  it("prefers the more specific class when several patterns match", () => {
    expect(classifyToolError(new Error("Sandbox command timed out"))).toBe(
      "timeout",
    );
    expect(
      classifyToolError(undefined, {
        exitCode: 127,
        error: "bash: nope: command not found",
      }),
    ).toBe("not_found");
    expect(classifyToolError(new Error("E2B sandbox is not running"))).toBe(
      "sandbox",
    );
    expect(
      classifyToolError(undefined, { error: "Invalid input: expected string" }),
    ).toBe("validation");
  });

  it("classifies E2B TimeoutError by name", () => {
    const err = new Error("request exceeded requestTimeoutMs");
    err.name = "TimeoutError";
    expect(classifyToolError(err)).toBe("timeout");
  });
});
