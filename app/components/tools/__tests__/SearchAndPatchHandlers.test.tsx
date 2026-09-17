import { render, screen } from "@testing-library/react";
import { SearchToolHandler } from "../SearchToolHandler";
import { PatchToolHandler } from "../PatchToolHandler";

const part = (over: Record<string, unknown>) => ({ toolCallId: "c1", ...over }) as any;

describe("SearchToolHandler", () => {
  it("shows a shimmer row while streaming", () => {
    render(<SearchToolHandler status="streaming" part={part({ type: "tool-search", state: "input-available", input: { kind: "grep", pattern: "TODO" } })} />);
    expect(screen.getByText(/Searching code/)).toBeInTheDocument();
    expect(screen.getByText(/'TODO'/)).toBeInTheDocument();
  });
  it("summarises grep matches", () => {
    render(<SearchToolHandler status="ready" part={part({ type: "tool-search", state: "output-available", input: { kind: "grep", pattern: "TODO" }, output: { count: 12, truncated: true } })} />);
    expect(screen.getByText(/Searched code · 12\+ matches/)).toBeInTheDocument();
  });
  it("summarises glob files and marks errors", () => {
    const { rerender, container } = render(
      <SearchToolHandler status="ready" part={part({ type: "tool-search", state: "output-available", input: { kind: "glob", pattern: "**/*.ts" }, output: { count: 3 } })} />,
    );
    expect(screen.getByText(/Found files · 3 files/)).toBeInTheDocument();
    rerender(<SearchToolHandler status="ready" part={part({ type: "tool-search", state: "output-error", input: { kind: "grep", pattern: "x" }, errorText: "boom" })} />);
    expect(container.querySelector('[data-ui="action-block"]')).toHaveAttribute("data-status", "error");
  });
});

describe("PatchToolHandler", () => {
  it("summarises a multi-file patch with line deltas", () => {
    render(
      <PatchToolHandler
        status="ready"
        part={part({ type: "tool-apply_patch", state: "output-available", output: { files: [{ relativePath: "a.ts", additions: 3, deletions: 1 }, { relativePath: "b.ts", additions: 2, deletions: 0 }] } })}
      />,
    );
    expect(screen.getByText(/Applied patch \(\+5 −1\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 files/)).toBeInTheDocument();
  });
  it("names a single file and renders failures", () => {
    const { rerender, container } = render(
      <PatchToolHandler status="ready" part={part({ type: "tool-apply_patch", state: "output-available", output: { files: [{ relativePath: "hello.txt", additions: 1, deletions: 0 }] } })} />,
    );
    expect(screen.getByText(/hello\.txt/)).toBeInTheDocument();
    rerender(<PatchToolHandler status="ready" part={part({ type: "tool-apply_patch", state: "output-error", errorText: "conflict" })} />);
    expect(screen.getByText(/Patch failed/)).toBeInTheDocument();
    expect(container.querySelector('[data-ui="action-block"]')).toHaveAttribute("data-status", "error");
  });
});
