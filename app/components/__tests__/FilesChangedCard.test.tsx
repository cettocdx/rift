import { render, screen, fireEvent } from "@testing-library/react";
import { FilesChangedCard } from "../FilesChangedCard";
import { getPerFileDiffStats } from "../agent-activity";
import type { SidebarContent } from "@/types/chat";

const mockOpenSidebar = jest.fn();
let mockMobile = false;
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mockMobile }));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({ openSidebar: mockOpenSidebar }),
}));

const file = (
  path: string,
  before: string | undefined,
  after: string,
  action: "editing" | "creating" = "editing",
): SidebarContent =>
  ({
    type: "file",
    path,
    action,
    originalContent: before,
    content: after,
  }) as unknown as SidebarContent;

describe("per-file diff stats", () => {
  it("accumulates by path and keeps the freshest execution", () => {
    const first = file("/root/app/a.ts", "one\n", "one\ntwo\n");
    const second = file("/root/app/a.ts", "one\ntwo\n", "one\n");
    const stats = getPerFileDiffStats([first, second]);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      path: "/root/app/a.ts",
      added: 1,
      removed: 1,
    });
    // The row must open the LAST view of the file, not the first.
    expect(stats[0].execution).toBe(second);
  });

  it("counts a fresh file as pure additions", () => {
    const stats = getPerFileDiffStats([
      file("/root/new.css", undefined, "a\nb\nc", "creating"),
    ]);
    expect(stats[0]).toMatchObject({ added: 3, removed: 0 });
  });
});

describe("the files-changed card", () => {
  beforeEach(() => {
    mockOpenSidebar.mockClear();
    mockMobile = false;
  });
  it("renders nothing when no files changed", () => {
    const { container } = render(<FilesChangedCard toolExecutions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("opens the Changes panel from Review and the actual file from a row", () => {
    const exec = file("/root/app/AGENTS.md", "x\n", "x\ny\nz\n");
    const opened = jest.fn();
    window.addEventListener("rift:open-workbench", opened);
    render(<FilesChangedCard toolExecutions={[exec]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(opened).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { kind: "review" } }),
    );
    expect(mockOpenSidebar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("app/AGENTS.md"));
    expect(mockOpenSidebar).toHaveBeenCalledWith(exec);
    window.removeEventListener("rift:open-workbench", opened);
  });
  it("shows every changed file in a mobile review dialog and closes it before opening a file", () => {
    mockMobile = true;
    const entries = ["a", "b", "c", "d"].map((name) =>
      file(name + ".ts", undefined, "x"),
    );
    render(<FilesChangedCard toolExecutions={entries} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("dialog", { name: "Changes" })).toBeVisible();
    expect(screen.getByText("This response")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review d.ts" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open d.ts in editor" }),
    );
    expect(mockOpenSidebar).toHaveBeenCalledWith(entries[3]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("shows three files initially and expands the remainder", () => {
    render(
      <FilesChangedCard
        toolExecutions={["a", "b", "c", "d"].map((name) =>
          file(name + ".ts", "1", "2"),
        )}
      />,
    );
    expect(screen.queryByText("d.ts")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 more file" }));
    expect(screen.getByText("d.ts")).toBeVisible();
  });
  it("keeps a confirmed edit reviewable without invented counts when its prior version is unknown", () => {
    const unknown = {
      ...file("notes.md", undefined, "existing content"),
      diffUnavailable: true,
    } as SidebarContent;
    render(<FilesChangedCard toolExecutions={[unknown]} />);
    expect(screen.getByText("Edited 1 file")).toBeVisible();
    expect(screen.getByText("Diff unavailable")).toBeVisible();
    expect(
      screen.queryByLabelText("Total changed lines"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("+1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("notes.md"));
    expect(mockOpenSidebar).toHaveBeenCalledWith(unknown);
  });
  it("does not show a partial total as the full diff when known and unknown edits mix", () => {
    render(
      <FilesChangedCard
        toolExecutions={[
          file("known.md", "old", "new"),
          {
            ...file("unknown.md", undefined, "text"),
            diffUnavailable: true,
          } as SidebarContent,
        ]}
      />,
    );
    expect(screen.getByText("Edited 2 files")).toBeVisible();
    expect(
      screen.queryByLabelText("Total changed lines"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeVisible();
    expect(screen.getByText("−1")).toBeVisible();
  });
  it("does not report a file as edited while approval or execution is pending", () => {
    const { container } = render(
      <FilesChangedCard
        toolExecutions={[
          { ...file("a.ts", "a", "b"), isExecuting: true } as SidebarContent,
        ]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
