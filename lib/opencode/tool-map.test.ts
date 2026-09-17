import {
  mapOpenCodeToolPart,
  mapToolName,
  diffToolProgress,
  OPENCODE_TOOL_NAME_MAP,
  RIFT_PASSTHROUGH_TOOLS,
  type OpenCodeToolSnapshot,
} from "@/lib/opencode/tool-map";

const snap = (
  tool: string,
  state: Partial<OpenCodeToolSnapshot["state"]> & { status: OpenCodeToolSnapshot["state"]["status"] },
): OpenCodeToolSnapshot => ({ tool, callID: "c1", state });

describe("mapToolName", () => {
  it("maps built-ins to RIFT renderer names", () => {
    expect(mapToolName("bash")).toBe("run_terminal_cmd");
    expect(mapToolName("read")).toBe("file");
    expect(mapToolName("edit")).toBe("file");
    expect(mapToolName("write")).toBe("file");
    expect(mapToolName("glob")).toBe("search");
    expect(mapToolName("grep")).toBe("search");
    expect(mapToolName("todowrite")).toBe("todo_write");
    expect(mapToolName("webfetch")).toBe("browse_url");
    expect(mapToolName("task")).toBe("delegate_task");
    expect(mapToolName("skill")).toBe("find_skills");
  });
  it("passes RIFT tools through by identity", () => {
    for (const t of RIFT_PASSTHROUGH_TOOLS) expect(mapToolName(t)).toBe(t);
  });
  it("passes MCP <server>_<tool> through, falls back for the rest", () => {
    expect(mapToolName("linear_create_issue")).toBe("linear_create_issue");
    expect(mapToolName("lsp")).toBe("opencode_lsp");
  });
  it("every mapped target is a distinct known RIFT name", () => {
    // guards against a typo mapping to a non-rendered name
    expect(new Set(Object.values(OPENCODE_TOOL_NAME_MAP))).toContain("file");
  });
});

describe("mapOpenCodeToolPart — input adapters", () => {
  it("bash → run_terminal_cmd with background detection", () => {
    const p = mapOpenCodeToolPart(
      snap("bash", { status: "running", input: { command: "nohup npm run dev &", description: "start dev" } }),
    );
    expect(p.toolName).toBe("run_terminal_cmd");
    expect(p.input).toMatchObject({ command: "nohup npm run dev &", brief: "start dev", is_background: true });
  });
  it("read → file with 1-indexed range from offset/limit", () => {
    const p = mapOpenCodeToolPart(snap("read", { status: "running", input: { filePath: "/a.ts", offset: 10, limit: 5 } }));
    expect(p.input).toMatchObject({ action: "read", path: "/a.ts", range: [10, 14] });
  });
  it("edit → file with single find/replace edit", () => {
    const p = mapOpenCodeToolPart(
      snap("edit", { status: "completed", input: { filePath: "/a.ts", oldString: "x", newString: "y", replaceAll: true }, output: "ok" }),
    );
    expect(p.input).toMatchObject({ action: "edit", path: "/a.ts", edits: [{ find: "x", replace: "y", all: true }] });
    expect(p.output).toMatchObject({ action: "edit", result: "ok" });
  });
  it("todowrite → todo_write, cancelled mapped to completed", () => {
    const p = mapOpenCodeToolPart(
      snap("todowrite", { status: "completed", input: { todos: [{ content: "a", status: "cancelled" }, { content: "b", status: "in_progress" }] }, output: "" }),
    );
    expect((p.input as any).todos).toEqual([
      { id: "1", content: "a", status: "completed" },
      { id: "2", content: "b", status: "in_progress" },
    ]);
  });
});

describe("mapOpenCodeToolPart — output/error", () => {
  it("bash completed → flat {output, exitCode}", () => {
    const p = mapOpenCodeToolPart(snap("bash", { status: "completed", input: { command: "ls" }, output: "file.txt", metadata: { exit: 0 } }));
    expect(p.output).toMatchObject({ output: "file.txt", exitCode: 0, aborted: false });
    expect(p.errorText).toBeUndefined();
  });
  it("error status → errorText, no output", () => {
    const p = mapOpenCodeToolPart(snap("bash", { status: "error", input: { command: "boom" }, error: "exit 1" }));
    expect(p.errorText).toBe("exit 1");
    expect(p.output).toBeUndefined();
  });
  it("grep completed → search {count, text}", () => {
    const p = mapOpenCodeToolPart(snap("grep", { status: "completed", input: { pattern: "TODO" }, output: "a.ts:1: TODO", metadata: { matches: 1 } }));
    expect(p.toolName).toBe("search");
    expect(p.output).toMatchObject({ count: 1, text: "a.ts:1: TODO" });
  });
});

describe("diffToolProgress", () => {
  it("emits only the new suffix as output grows", () => {
    const a = diffToolProgress(undefined, snap("bash", { status: "running", metadata: { output: "line1\n" } }));
    expect(a.delta).toBe("line1\n");
    const b = diffToolProgress(a.cursor, snap("bash", { status: "running", metadata: { output: "line1\nline2\n" } }));
    expect(b.delta).toBe("line2\n");
  });
  it("returns null when unchanged", () => {
    const a = diffToolProgress({ emitted: "x" }, snap("bash", { status: "running", metadata: { output: "x" } }));
    expect(a.delta).toBeNull();
  });
  it("marks a rewound preview instead of losing place", () => {
    const r = diffToolProgress({ emitted: "old long tail" }, snap("bash", { status: "running", metadata: { output: "fresh tail" } }));
    expect(r.delta).toContain("preview trimmed");
    expect(r.delta).toContain("fresh tail");
  });
});
