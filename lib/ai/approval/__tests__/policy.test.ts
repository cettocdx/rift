import {
  gateToolSet,
  parseApprovalMode,
  requiresToolApproval,
} from "../policy";
describe("execution permissions", () => {
  it("defaults to asking and rejects unrecognized policies", () => {
    expect(parseApprovalMode(undefined)).toBe("ask");
    expect(() => parseApprovalMode("ignore-checks")).toThrow();
  });
  it.each([
    "run_terminal_cmd",
    "mcp__github__create_issue",
    "future_unknown_tool",
  ])("never auto-approves %s", (tool) => {
    expect(requiresToolApproval("ask", tool, {})).toBe(true);
    expect(requiresToolApproval("auto", tool, {})).toBe(true);
    expect(requiresToolApproval("full", tool, {})).toBe(false);
  });
  it("distinguishes reading from editing on the actual unified file schema", () => {
    expect(requiresToolApproval("ask", "file", { action: "read" })).toBe(false);
    expect(requiresToolApproval("ask", "file", { action: "write" })).toBe(true);
    expect(requiresToolApproval("auto", "file", { action: "edit" })).toBe(
      false,
    );
    expect(requiresToolApproval("auto", "file", { operation: "read" })).toBe(
      true,
    );
  });
  it("does not execute while approval is pending; forwards input after approval", async () => {
    let allow!: () => void;
    const gate = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          allow = resolve;
        }),
    );
    const execute = jest.fn(
      async (input: unknown, _options?: unknown) => input,
    );
    const tools = gateToolSet({ edit: { execute } }, gate);
    const input = { file: "a.ts" };
    const result = tools.edit.execute(input, { toolCallId: "one" });
    expect(execute).not.toHaveBeenCalled();
    allow();
    await expect(result).resolves.toEqual(input);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("denial prevents the underlying action", async () => {
    const execute = jest.fn();
    const tools = gateToolSet({ edit: { execute } }, async () => {
      throw new Error("Denied");
    });
    await expect(tools.edit.execute({}, { toolCallId: "one" })).rejects.toThrow(
      "Denied",
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it("stopping during approval prevents execution even if approval races with Stop", async () => {
    const signal = new AbortController();
    const execute = jest.fn();
    const tools = gateToolSet({ edit: { execute } }, async () => {
      signal.abort();
    });
    await expect(
      tools.edit.execute({}, { toolCallId: "one", abortSignal: signal.signal }),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});

it("crosses the execution barrier only after approval, and fails closed if ownership is lost", async () => {
  const execute = jest.fn();
  const barrier = jest.fn(async () => {
    throw new Error("lost ownership");
  });
  let approve!: () => void;
  const gate = () =>
    new Promise<void>((resolve) => {
      approve = resolve;
    });
  const tools = gateToolSet(gateToolSet({ edit: { execute } }, barrier), gate);
  const pending = tools.edit.execute({}, { toolCallId: "edit" });
  expect(barrier).not.toHaveBeenCalled();
  approve();
  await expect(pending).rejects.toThrow("lost ownership");
  expect(barrier).toHaveBeenCalledTimes(1);
  expect(execute).not.toHaveBeenCalled();
});
