import { createCheckpointToolBarrier } from "../checkpoint-tool-barrier";

function setup() {
  const read = jest.fn(async () => true),
    effect = jest.fn(async () => true);
  return {
    read,
    effect,
    gate: createCheckpointToolBarrier({
      isDisabled: () => false,
      assertRead: read,
      markEffect: effect,
    }),
  };
}
it.each([
  "read_file",
  "list_files",
  "desktop_workspace_read",
  "search_connected_tools",
])("keeps %s replayable while still checking ownership", async (toolName) => {
  const { gate, read, effect } = setup();
  await gate({ toolName, input: {}, toolCallId: "call" });
  expect(read).toHaveBeenCalledTimes(1);
  expect(effect).not.toHaveBeenCalled();
});
it.each(["read", "view"])(
  "recognizes the file %s action only",
  async (action) => {
    const { gate, read, effect } = setup();
    await gate({ toolName: "file", input: { action }, toolCallId: "call" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(effect).not.toHaveBeenCalled();
  },
);
it.each([
  "run_terminal_cmd",
  "mcp_read_file",
  "delegate_task",
  "find_skills",
  "write_file",
])(
  "conservatively journals %s regardless of description or input hints",
  async (toolName) => {
    const { gate, read, effect } = setup();
    await gate({ toolName, input: { readOnly: true }, toolCallId: "call" });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  },
);
it("rejects canceled or superseded readers before tools start", async () => {
  const { gate, read } = setup();
  read.mockResolvedValue(false);
  await expect(
    gate({ toolName: "read_file", input: {}, toolCallId: "call" }),
  ).rejects.toThrow(/owns/);
  const stopped = new AbortController();
  stopped.abort(new Error("Stopped"));
  read.mockClear();
  await expect(
    gate({
      toolName: "read_file",
      input: {},
      toolCallId: "call",
      signal: stopped.signal,
    }),
  ).rejects.toThrow("Stopped");
  expect(read).not.toHaveBeenCalled();
});
