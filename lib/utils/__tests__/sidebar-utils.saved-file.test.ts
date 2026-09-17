import { extractSidebarContentFromMessage } from "../sidebar-utils";

const extract = (output: unknown) =>
  extractSidebarContentFromMessage({
    role: "assistant",
    parts: [
      {
        type: "tool-file",
        state: "output-available",
        toolCallId: "saved-edit",
        input: { action: "edit", path: "/project/main.js", text: "" },
        output,
      },
    ],
  })[0];

describe("saved file edit output", () => {
  it.each([false, true])(
    "reads numbered legacy content, wrapped=%s",
    (wrapped) => {
      const content =
        "Multi-edit completed: 1 edits applied, 1 total replacements made\nLatest content with line numbers:\n     1|const value = 1;\n     2|  console.log(value);\n     3|";
      expect(extract(wrapped ? { content } : content)).toMatchObject({
        content: "const value = 1;\n  console.log(value);\n",
        diffUnavailable: true,
      });
    },
  );
  it("retains explicit before/after data including an empty edited file", () => {
    expect(
      extract({ originalContent: "old", modifiedContent: "" }),
    ).toMatchObject({
      content: "",
      originalContent: "old",
      modifiedContent: "",
    });
    expect(
      extract({ originalContent: "old", modifiedContent: "" }),
    ).not.toHaveProperty("diffUnavailable");
  });
});
