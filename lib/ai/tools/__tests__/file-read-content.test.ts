import { createFile } from "../file";
import type { ToolContext } from "@/types";
jest.mock("@/lib/ai/providers", () => ({
  supportsMultimodalToolResults: () => true,
}));
jest.mock("@/lib/posthog/server", () => ({ phLogger: { event: jest.fn() } }));
const options = { toolCallId: "read-test", messages: [] };
function fixture(content: string) {
  const read = jest.fn().mockResolvedValue(content);
  const tool = createFile({
    sandboxManager: {
      getSandbox: async () => ({ sandbox: { files: { read } } }),
    },
  } as unknown as ToolContext);
  return {
    read,
    run: (range?: number[]) =>
      tool.execute!(
        {
          action: "read",
          path: "/tmp/file",
          brief: "Read file",
          range,
        } as never,
        options,
      ),
  };
}
it("returns an empty file as valid content, not a failed operation", async () => {
  expect(await fixture("").run()).toEqual(
    expect.objectContaining({ originalContent: "" }),
  );
  expect(await fixture("").run()).not.toHaveProperty("error");
});
it("preserves whitespace-only content and line ranges", async () => {
  const result = await fixture("  \n\t\n").run([2, 2]);
  expect(result).toEqual(expect.objectContaining({ originalContent: "\t" }));
});
it.each([
  "\uFFFDPNG\r\n\x1a\n\x00\x00IHDR",
  "%PDF-1.7\n\x00binary",
  "\x00\x00\x01\x03payload",
])("does not emit binary data as model text", async (content) => {
  const result = await fixture(content).run();
  expect(result).not.toHaveProperty("error");
  expect(result).toEqual(
    expect.objectContaining({
      kind: "binary",
      content: expect.stringContaining("view"),
    }),
  );
  expect(JSON.stringify(result)).not.toContain("IHDR");
  expect(result).not.toHaveProperty("originalContent");
});
it("keeps Unicode text intact", async () => {
  expect(await fixture("Türkçe 日本語 🙂\n").run()).toEqual(
    expect.objectContaining({ originalContent: "Türkçe 日本語 🙂\n" }),
  );
});

it.each(["README.md", "/tmp/explicit.md"])(
  "resolves %s against the prepared cloud checkout only when relative",
  async (path) => {
    const read = jest.fn().mockResolvedValue("repository content");
    const context = {
      sandboxManager: {
        getSandbox: async () => ({ sandbox: { files: { read } } }),
      },
    } as unknown as ToolContext;
    const tool = createFile(context);
    context.projectWorkingDirectory = "/home/user/selected-repo";
    await tool.execute!(
      { action: "read", path, brief: "Read selected repository" } as never,
      options,
    );
    expect(read).toHaveBeenCalledWith(
      path.startsWith("/") ? path : "/home/user/selected-repo/README.md",
      expect.anything(),
    );
  },
);

it("keeps local relative paths in the local runner despite a cloud default", async () => {
  const read = jest.fn().mockResolvedValue("local file");
  const tool = createFile({
    projectWorkingDirectory: "/home/user/selected-repo",
    sandboxManager: {
      getSandbox: async () => ({
        sandbox: { sandboxKind: "centrifugo", files: { read } },
      }),
    },
  } as unknown as ToolContext);
  await tool.execute!(
    { action: "read", path: "README.md", brief: "Read local file" } as never,
    options,
  );
  expect(read).toHaveBeenCalledWith("README.md", expect.anything());
});
