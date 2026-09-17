import { tool } from "ai";
import { z } from "zod";
import {
  createReadOnlySubagentTools,
  awaitSubagentRead,
} from "../utils/subagent-read-only-tools";

const definition = (execute = jest.fn(async () => "read")) =>
  tool({ inputSchema: z.any(), execute });
describe("subagent capability projection", () => {
  it("selects only known reads, excluding commands, uploads, MCP, writes and recursive delegation", () => {
    const names = [
      "file",
      "list_files",
      "web_search",
      "open_url",
      "browse_url",
      "desktop_workspace_read",
      "desktop_workspace_list",
      "desktop_workspace_list_grants",
      "run_terminal_cmd",
      "get_terminal_files",
      "delegate_task",
      "mcp_files_read",
      "write_file",
      "create_note",
      "find_skills",
    ];
    const tools = Object.fromEntries(names.map((name) => [name, definition()]));
    expect(Object.keys(createReadOnlySubagentTools(tools))).toEqual(
      names.slice(0, 8),
    );
  });
  it("intersects the delegated custom profile's permissions without granting absent parent tools", () => {
    const parent = {
      file: definition(),
      web_search: definition(),
      run_terminal_cmd: definition(),
    };
    expect(
      Object.keys(
        createReadOnlySubagentTools(parent, [
          "file",
          "list_files",
          "run_terminal_cmd",
        ]),
      ),
    ).toEqual(["file"]);
    expect(createReadOnlySubagentTools(parent, [])).toEqual({});
  });
  it.each(["write", "append", "edit", "view", "READ"])(
    "rejects direct %s calls before the parent's executor",
    async (action) => {
      const execute = jest.fn(async () => "unsafe");
      const projected = createReadOnlySubagentTools({
        file: definition(execute),
      });
      await expect(
        projected.file.execute!(
          { action, path: "/a", brief: "Read" },
          { toolCallId: "child", messages: [] },
        ),
      ).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it("preserves the original read executor, signal and call identity", async () => {
    const execute = jest.fn(async () => "source");
    const projected = createReadOnlySubagentTools({
      file: definition(execute),
    });
    const options = {
      toolCallId: "child",
      messages: [],
      abortSignal: new AbortController().signal,
    };
    await expect(
      projected.file.execute!(
        { action: "read", path: "/a", brief: "Read", range: [1, 20] },
        options,
      ),
    ).resolves.toBe("source");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: "read", range: [1, 20] }),
      options,
    );
  });
  it("cancels a stalled read without waiting for a non-cancellable adapter", async () => {
    const controller = new AbortController();
    const pending = awaitSubagentRead(new Promise(() => {}), controller.signal);
    controller.abort(new Error("Stopped"));
    await expect(pending).rejects.toThrow("Stopped");
  });
});
