import { createListFiles } from "../list-files";
import type { ToolContext } from "@/types";

function fixture() {
  const list = jest.fn().mockResolvedValue(
    Array.from({ length: 105 }, (_, index) => ({
      name: `file-${index}.ts`,
      type: "file",
    })),
  );
  const run = jest.fn();
  const write = jest.fn();
  const getSandbox = jest.fn().mockResolvedValue({
    sandbox: { files: { list, write }, commands: { run } },
  });
  const tool = createListFiles({
    sandboxManager: { getSandbox },
  } as unknown as ToolContext);
  return { tool, list, run, write, getSandbox };
}
const options = { toolCallId: "directory-read", messages: [] };

it("lists relative paths from the prepared cloud checkout", async () => {
  const list = jest.fn().mockResolvedValue([]);
  const tool = createListFiles({
    projectWorkingDirectory: "/home/user/selected-repo",
    sandboxManager: {
      getSandbox: async () => ({ sandbox: { files: { list } } }),
    },
  } as unknown as ToolContext);
  await tool.execute!(
    { path: ".", brief: "Read repository layout" } as never,
    options,
  );
  expect(list).toHaveBeenCalledWith("/home/user/selected-repo");
});

describe("selected execution target directory reads", () => {
  it("describes selected-target reads and accepts native local paths without rewriting them", async () => {
    const { tool, list, run, write } = fixture();
    expect(tool.description).toContain("selected execution target");
    expect(tool.description).not.toContain("current cloud workspace");
    const result = await tool.execute!(
      { path: "C:\\Users\\demo\\project", brief: "Read local layout" } as never,
      options,
    );
    expect(list).toHaveBeenCalledWith("C:\\Users\\demo\\project");
    expect(result).toHaveProperty("path", "C:\\Users\\demo\\project");
    expect(run).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("paginates metadata without a shell or file mutation", async () => {
    const { tool, list, run, write } = fixture();
    const first = await tool.execute!(
      { path: "/root/project", brief: "Read project layout" } as never,
      options,
    );
    expect(first).toEqual(
      expect.objectContaining({ total: 105, nextOffset: 100 }),
    );
    expect((first as { entries: unknown[] }).entries).toHaveLength(100);
    const last = await tool.execute!(
      {
        path: "/root/project",
        offset: 100,
        limit: 100,
        brief: "Remaining project files",
      },
      options,
    );
    expect((last as { entries: unknown[] }).entries).toHaveLength(5);
    expect(last).not.toHaveProperty("nextOffset");
    expect(list).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects invalid pagination before accessing the workspace", async () => {
    const { tool, getSandbox } = fixture();
    const result = await tool.execute!(
      { path: "/root/project", offset: -1, limit: 999, brief: "Read" },
      options,
    );
    expect(result).toHaveProperty("error");
    expect(getSandbox).not.toHaveBeenCalled();
  });

  it("returns a failed directory read as an error, never an empty success", async () => {
    const { tool, list } = fixture();
    list.mockRejectedValueOnce(new Error("Directory not found"));
    const result = await tool.execute!(
      { path: "/missing", brief: "Read" } as never,
      options,
    );
    expect(result).toEqual({ error: "Directory not found" });
  });

  it("does not open a workspace after cancellation", async () => {
    const { tool, getSandbox } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      tool.execute!({ path: "/root/project", brief: "Read" } as never, {
        ...options,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(getSandbox).not.toHaveBeenCalled();
  });
});
