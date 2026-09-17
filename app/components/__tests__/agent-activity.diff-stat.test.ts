import { getRunDiffStat } from "../agent-activity";
import type { SidebarContent } from "@/types/chat";

const fileWrite = (
  overrides: Partial<Extract<SidebarContent, { path: string }>>,
): SidebarContent =>
  ({
    path: "src/app.ts",
    content: "",
    action: "editing",
    ...overrides,
  }) as SidebarContent;

describe("getRunDiffStat", () => {
  it("counts every line of a newly created file as added", () => {
    expect(
      getRunDiffStat([fileWrite({ action: "creating", content: "a\nb\nc" })]),
    ).toEqual({ added: 3, removed: 0 });
  });

  it("counts only the lines an edit actually changed", () => {
    expect(
      getRunDiffStat([
        fileWrite({
          originalContent: "keep\nold\nkeep2",
          modifiedContent: "keep\nnew\nkeep2\nextra",
        }),
      ]),
    ).toEqual({ added: 2, removed: 1 });
  });

  it("does not report a moved block as a rewrite", () => {
    // Positional comparison would call this 3 additions and 3 removals.
    expect(
      getRunDiffStat([
        fileWrite({
          originalContent: "a\nb\nc",
          modifiedContent: "c\na\nb",
        }),
      ]),
    ).toEqual({ added: 0, removed: 0 });
  });

  it("accumulates across files and ignores reads", () => {
    expect(
      getRunDiffStat([
        fileWrite({ action: "creating", content: "x\ny" }),
        fileWrite({
          path: "src/other.ts",
          originalContent: "gone",
          modifiedContent: "",
        }),
        fileWrite({ action: "reading", content: "not\na\nchange" }),
        fileWrite({ action: "viewing", content: "also\nnot" }),
      ]),
    ).toEqual({ added: 2, removed: 1 });
  });

  it("reports nothing for a run that touched no files", () => {
    expect(getRunDiffStat([])).toEqual({ added: 0, removed: 0 });
  });
});
