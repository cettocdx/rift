import { createEventTranslator } from "@/lib/opencode/event-translator";
import type { OpenCodeEvent } from "@/lib/opencode/client";

const upd = (part: Record<string, unknown>): OpenCodeEvent => ({
  type: "message.part.updated",
  properties: { sessionID: "s", part: { sessionID: "s", messageID: "m1", ...part }, time: 1 },
});
const delta = (partID: string, d: string, field = "text"): OpenCodeEvent => ({
  type: "message.part.delta",
  properties: { sessionID: "s", messageID: "m1", partID, field, delta: d },
});
const types = (chunks: { type: string }[]) => chunks.map((c) => c.type);

describe("event translator — text", () => {
  it("opens a step and streams deltas, then closes on time.end", () => {
    const t = createEventTranslator();
    const a = t.feed(delta("p1", "Hel"));
    expect(types(a)).toEqual(["start-step", "text-start", "text-delta"]);
    const b = t.feed(delta("p1", "lo"));
    expect(b).toEqual([{ type: "text-delta", id: "p1", delta: "lo" }]);
    // durable full part with the same text → no duplicate delta; end closes it
    const c = t.feed(upd({ id: "p1", type: "text", text: "Hello", time: { start: 1, end: 2 } }));
    expect(types(c)).toEqual(["text-end"]);
  });

  it("emits only the missing suffix when a full part carries more than was streamed", () => {
    const t = createEventTranslator();
    t.feed(delta("p1", "Hel"));
    const c = t.feed(upd({ id: "p1", type: "text", text: "Hello world", time: { start: 1 } }));
    expect(c).toEqual([{ type: "text-delta", id: "p1", delta: "lo world" }]);
  });

  it("routes reasoning separately and can suppress it", () => {
    const on = createEventTranslator({ sendReasoning: true });
    expect(types(on.feed(delta("r1", "think", "reasoning")))).toEqual(["start-step", "reasoning-start", "reasoning-delta"]);
    const off = createEventTranslator({ sendReasoning: false });
    expect(off.feed(delta("r1", "think", "reasoning"))).toEqual([]);
  });
});

describe("event translator — tools", () => {
  const bash = (status: string, extra: Record<string, unknown> = {}) =>
    upd({
      id: "part-bash",
      type: "tool",
      tool: "bash",
      callID: "call_1",
      state: { status, input: { command: "npm test", description: "run tests" }, ...extra },
    });

  it("maps bash to run_terminal_cmd, streams progress, then outputs", () => {
    const completed: any[] = [];
    const t = createEventTranslator({ callbacks: { onToolCompleted: (i) => completed.push(i) } });

    const a = t.feed(bash("pending"));
    expect(types(a)).toEqual(["start-step", "tool-input-start", "tool-input-available"]);
    expect(a[1]).toMatchObject({ toolCallId: "call_1", toolName: "run_terminal_cmd" });
    expect((a[2] as any).input).toMatchObject({ command: "npm test", brief: "run tests" });

    const b = t.feed(bash("running", { metadata: { output: "line1\n" } }));
    expect(b).toEqual([
      { type: "data-terminal", id: "oc-call_1-1", data: { terminal: "line1\n", toolCallId: "call_1", action: "exec" } },
    ]);
    const c = t.feed(bash("running", { metadata: { output: "line1\nline2\n" } }));
    expect((c[0] as any).data.terminal).toBe("line2\n");

    const d = t.feed(bash("completed", { output: "line1\nline2\nok", metadata: { exit: 0 } }));
    expect(d).toEqual([
      { type: "tool-output-available", toolCallId: "call_1", output: expect.objectContaining({ output: "line1\nline2\nok", exitCode: 0 }) },
    ]);
    expect(completed).toEqual([expect.objectContaining({ toolName: "run_terminal_cmd", callID: "call_1", ok: true })]);
    // a repeated completed frame does not re-emit
    expect(t.feed(bash("completed", { output: "line1\nline2\nok", metadata: { exit: 0 } }))).toEqual([]);
  });

  it("emits tool-output-error on error state", () => {
    const t = createEventTranslator();
    t.feed(bash("pending"));
    const e = t.feed(bash("error", { error: "exit code 1" }));
    expect(e).toEqual([{ type: "tool-output-error", toolCallId: "call_1", errorText: "exit code 1" }]);
  });

  it("uses RIFT names for file tools", () => {
    const t = createEventTranslator();
    const a = t.feed(
      upd({ id: "p", type: "tool", tool: "edit", callID: "c2", state: { status: "pending", input: { filePath: "/a.ts", oldString: "x", newString: "y" } } }),
    );
    expect(a[1]).toMatchObject({ type: "tool-input-start", toolName: "file" });
    expect((a[2] as any).input).toMatchObject({ action: "edit", path: "/a.ts" });
  });
});

describe("event translator — steps", () => {
  it("closes the step on step-finish and reports tokens + tool names", () => {
    const finishes: any[] = [];
    const t = createEventTranslator({ callbacks: { onStepFinish: (info, tools) => finishes.push({ info, tools }) } });
    t.feed(upd({ id: "ss", type: "step-start" }));
    t.feed(upd({ id: "p", type: "tool", tool: "grep", callID: "c9", state: { status: "completed", input: { pattern: "x" }, output: "", metadata: { matches: 0 } } }));
    const f = t.feed(
      upd({ id: "sf", type: "step-finish", reason: "tool-calls", cost: 0.03, tokens: { input: 5973, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } }),
    );
    expect(types(f)).toEqual(["finish-step"]);
    expect(finishes).toEqual([
      { info: { reason: "tool-calls", cost: 0.03, tokens: { input: 5973, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } }, tools: ["search"] },
    ]);
  });

  it("a second step-start closes the previous open step", () => {
    const t = createEventTranslator();
    t.feed(delta("p1", "a"));
    const s = t.feed(upd({ id: "ss2", type: "step-start" }));
    expect(types(s)).toEqual(["finish-step", "start-step"]);
  });

  it("finalize closes open text, fails dangling tools, and ends the step", () => {
    const t = createEventTranslator();
    t.feed(delta("p1", "partial"));
    t.feed(upd({ id: "p", type: "tool", tool: "bash", callID: "c3", state: { status: "running", input: { command: "sleep" } } }));
    const f = t.finalize();
    expect(types(f)).toEqual(["text-end", "tool-output-error", "finish-step"]);
    expect(f[1]).toMatchObject({ toolCallId: "c3", errorText: "Tool did not complete." });
    expect(t.finalize()).toEqual([]); // idempotent
  });

  it("ignores non-UI parts", () => {
    const t = createEventTranslator();
    expect(t.feed(upd({ id: "x", type: "snapshot", snapshot: "abc" }))).toEqual([]);
    expect(t.feed({ type: "session.status", properties: { status: { type: "busy" } } })).toEqual([]);
  });

  it("ignores parts that belong to the user message (OpenCode re-publishes them)", () => {
    const t = createEventTranslator();
    t.feed({ type: "message.updated", properties: { sessionID: "s", info: { id: "u1", role: "user" } } });
    t.feed({ type: "message.updated", properties: { sessionID: "s", info: { id: "a1", role: "assistant" } } });
    const userPart = t.feed({
      type: "message.part.updated",
      properties: { sessionID: "s", part: { id: "pu", type: "text", messageID: "u1", text: "Reply with OK", time: { start: 1, end: 2 } } },
    });
    expect(userPart).toEqual([]);
    const userDelta = t.feed({ type: "message.part.delta", properties: { sessionID: "s", messageID: "u1", partID: "pu", field: "text", delta: "x" } });
    expect(userDelta).toEqual([]);
    const asst = t.feed({
      type: "message.part.updated",
      properties: { sessionID: "s", part: { id: "pa", type: "text", messageID: "a1", text: "OK", time: { start: 1 } } },
    });
    expect(types(asst)).toEqual(["start-step", "text-start", "text-delta"]);
  });
});
