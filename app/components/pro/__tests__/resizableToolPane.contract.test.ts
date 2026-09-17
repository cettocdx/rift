import { readFileSync } from "node:fs";
import { join } from "node:path";

const readWorkspaceFile = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

const css = readWorkspaceFile("app/globals.css");
const chat = readWorkspaceFile("app/components/chat.tsx");

function declarationBlock(marker: string): string {
  const markerIndex = css.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const openingBrace = css.indexOf("{", markerIndex);
  const closingBrace = css.indexOf("\n}", openingBrace);
  expect(openingBrace).toBeGreaterThan(markerIndex);
  expect(closingBrace).toBeGreaterThan(openingBrace);
  return css.slice(openingBrace + 1, closingBrace);
}

describe("Build tool-pane resize contract", () => {
  it("uses a generous zero-layout-cost hit area with a quiet hairline", () => {
    const handle = declarationBlock(".pro-resize-handle {");
    const hairline = declarationBlock(".pro-resize-handle::before {");

    expect(handle).toContain("width: 12px");
    expect(handle).toContain("flex: 0 0 12px");
    expect(handle).toContain("margin-inline: -6px");
    expect(handle).toContain("cursor: col-resize");
    expect(handle).toContain("touch-action: none");
    expect(handle).toContain("user-select: none");
    expect(hairline).toContain("width: 1px");
    expect(css).toContain(".pro-resize-handle:focus-visible::before");
    expect(css).toContain('.pro-resize-handle[data-resizing="true"]::before');
  });

  it("keeps live drag immediate and protects embedded previews", () => {
    expect(chat).toContain("data-rift-tool-pane-resizer");
    expect(chat).toContain('aria-controls="rift-build-tool-pane"');
    expect(chat).toContain('id="rift-build-tool-pane"');
    expect(chat).toMatch(/data-resizing=\{\s*isToolPaneResizing/);
    expect(chat).toContain("className={dockStyles.container}");
    expect(chat).toContain("? resizeHandleProps");
    expect(css).toContain('html[data-rift-panel-resizing="true"] iframe');

    const pane = declarationBlock(".pro-terminal-pane {");
    expect(pane).toContain("min-width: min(280px, 72%)");
    expect(pane).toContain("max-width: 72%");
  });
});
