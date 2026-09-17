import { readFileSync } from "node:fs";
import { join } from "node:path";

const readComponent = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

const cli = readComponent("app/components/workbench/WorkbenchCli.tsx");
const editor = readComponent("app/components/workbench/WorkbenchEditor.tsx");
const titlebar = readComponent("app/components/pro/ProTitlebar.tsx");
const settings = [
  readComponent("app/components/settings/SettingsShell.tsx"),
  readComponent("app/components/settings/SettingsNav.tsx"),
  readComponent("app/components/settings/SettingsIndex.tsx"),
].join("\n");
const sidebar = readComponent("app/components/SidebarHeader.tsx");
// The sidebar's row and section-label tokens moved here so the landing page's
// working replica of the workspace renders from the same source as the product.
// The contract is on the tokens, so it follows them.
const workspaceChrome = readComponent("lib/ui/workspace-chrome.ts");
const sidebarProjects = readComponent("app/components/SidebarProjects.tsx");
const sidebarUser = readComponent("app/components/SidebarUserNav.tsx");
const chatItem = readComponent("app/components/ChatItem.tsx");
const sidebarPrimitive = readComponent("components/ui/sidebar.tsx");
const chatInputTextarea = readComponent(
  "app/components/ChatInput/ChatInputTextarea.tsx",
);
const baseInput = readComponent("components/ui/input.tsx");
const baseTextarea = readComponent("components/ui/textarea.tsx");
const baseSelect = readComponent("components/ui/select.tsx");
const command = readComponent("components/ui/command.tsx");
const workbench = readComponent("app/components/workbench/Workbench.tsx");
const statusBar = readComponent("app/components/pro/ProStatusBar.tsx");
const filePart = readComponent("app/components/FilePartRenderer.tsx");
const senderMark = readComponent("app/components/MessageSenderMark.tsx");

/** Trace glyphs render at Grok's measured 14px on a hairline stroke. */
const ACTIVITY_TRACE_ICON = "TRACE_ICON_CLASS";

describe("Cursor text hierarchy contract", () => {
  it("uses explicit primary, secondary, and tertiary tokens for readable chrome", () => {
    expect(cli).toContain(
      '<span className="text-foreground">RIFT isolated CLI</span>',
    );
    expect(cli).toContain("text-[var(--pro-text-secondary)]");
    expect(cli).toContain("text-[var(--pro-text-muted)]");
    expect(editor).toContain("text-[var(--pro-text-secondary)]");
    expect(editor).toContain("text-[var(--pro-text-muted)]");
    expect(titlebar).toContain("text-[var(--pro-text-secondary)]");
    expect(settings).toContain("text-foreground");
    expect(settings).toContain("text-muted-foreground");
    // The Pro shell's brand row is gone -- neither reference app puts its own
    // name in the sidebar -- so only the standard shell's row is pinned here.
    expect(sidebar).toContain(
      "gap-2 rounded-md px-1.5 py-1 text-foreground transition-colors",
    );
    expect(workbench).toContain(
      'textClassName="hidden text-foreground sm:inline"',
    );
    expect(workbench).toContain("text-[var(--pro-text-secondary)]");
    expect(workbench).toContain("text-[var(--pro-text-muted)]");
    expect(statusBar).toContain("text-[var(--pro-text-secondary)]");
  });

  it("matches the sidebar's text and icon roles", () => {
    // The September desktop comparison preserves primary row text and quieter
    // icons. Cursor's live ui-sidebar uses 13px/18px rows at weight 418.
    expect(workspaceChrome).toContain(
      "text-[13px] font-[418] leading-[18px] tracking-[-0.08px] text-sidebar-foreground",
    );
    expect(workspaceChrome).toContain(
      '"bg-sidebar-accent text-sidebar-foreground [&>svg]:text-sidebar-foreground"',
    );
    // A row answers the press with a fill one step past hover — it is too wide
    // to scale without looking like it moved.
    expect(workspaceChrome).toContain(
      "hover:bg-sidebar-accent hover:text-sidebar-foreground hover:[&>svg]:text-sidebar-foreground active:bg-sidebar-accent",
    );
    expect(workspaceChrome).toContain(
      "[&>svg]:text-[var(--cursor-icon-secondary)]",
    );
    expect(workspaceChrome).toContain(
      "text-[var(--cursor-text-tertiary)] transition-colors",
    );
    // Resting rows use the shared secondary ink; selection promotes them.
    expect(chatItem).toContain('"bg-sidebar-accent text-sidebar-foreground"');
    expect(chatItem).toContain('"text-[var(--cursor-text-secondary)]"');
    expect(sidebarProjects).toContain("sidebarNavRowClass");
    expect(sidebarProjects).toContain(
      'color: "text-[var(--cursor-icon-secondary)]"',
    );
    expect(sidebarUser).toContain(
      "text-ui-nav font-[418] leading-[18px] text-foreground",
    );
    expect(sidebarUser).toContain("leading-tight text-muted-foreground");
    expect(sidebarPrimitive).toContain(
      "text-[var(--cursor-text-tertiary)] ring-sidebar-ring",
    );
    expect(sidebarPrimitive).not.toContain("text-sidebar-foreground/70");
  });

  // Measured from Grok's live run trace, 17 Aug 2026. See
  // docs/product-transformation/grok-agent-behaviour-2026-08-17.md — these are
  // observations, so a change here means the reference changed, not a taste call.
  it("matches the measured geometry of the operation trace", () => {
    // 24px row, 8px gap = a 32px pitch.
    expect(workspaceChrome).toContain(
      "flex h-6 w-full items-center gap-[11px]",
    );
    expect(workspaceChrome).toContain("flex h-2 items-center");
    // A 1x5px tick at 20%, centred on the 14px icon column.
    expect(workspaceChrome).toContain(
      "ms-[6.5px] h-[5px] w-px bg-foreground/20",
    );
    expect(workspaceChrome).toContain("flex size-[14px] shrink-0");
    // Verb and argument sit on a baseline 6px apart, not centred.
    //
    // 14px, as measured from the reference trace. This was briefly dropped to
    // 12px so the Operations list would match the Plan and Subagents headings
    // sharing its panel. On screen that failed: Operations is the list people
    // read while a run works, and it is the longest one in the pane, so the
    // internal consistency cost more legibility than it bought. The size step
    // between the trace and the labels above it is intended.
    expect(workspaceChrome).toContain("items-baseline gap-1.5 leading-6");
    expect(workspaceChrome).toContain(
      "text-[length:var(--rift-type-message)] leading-6 tracking-[-0.1px] text-[var(--cursor-text-secondary)]",
    );
    expect(workspaceChrome).toContain(
      "text-[length:var(--rift-type-message)] leading-snug tracking-[-0.1px] text-[var(--cursor-text-tertiary)]",
    );
    // Mono one step down: it runs wider than the sans at the same size, and a
    // path that outruns its row is worse than a path a pixel smaller.
    expect(workspaceChrome).toContain(
      "font-mono text-[length:var(--rift-type-body)] leading-6 tracking-[-0.1px] text-[var(--cursor-text-tertiary)]",
    );
    // Hovering promotes both registers one step.
    expect(workspaceChrome).toContain("group-hover/row:text-foreground");
    expect(workspaceChrome).toContain(
      "group-hover/row:text-[var(--cursor-text-secondary)]",
    );
  });

  it("keeps the trace to two registers — no step numbers, no trailing status column", () => {
    const activityPanel = readComponent(
      "app/components/AgentActivityPanel.tsx",
    );
    const heroWorkspace = readComponent(
      "app/components/landing-v2/HeroWorkspace.tsx",
    );
    for (const source of [activityPanel, heroWorkspace]) {
      // The zero-padded step counter that used to trail every row.
      expect(source).not.toContain('String(index + 1).padStart(2, "0")');
    }
    // Status is carried by the verb's tense and the sweep, not a check column.
    expect(activityPanel).toContain("rift-thinking-shimmer");
    expect(activityPanel).toContain(ACTIVITY_TRACE_ICON);
  });

  it("uses the tertiary role for every shared input placeholder", () => {
    for (const inputSource of [
      chatInputTextarea,
      baseInput,
      baseTextarea,
      baseSelect,
      command,
    ]) {
      expect(inputSource).toContain(
        "placeholder:text-[var(--cursor-text-tertiary)]",
      );
      expect(inputSource).not.toContain("placeholder:text-muted-foreground");
      expect(inputSource).not.toContain(
        "placeholder:text-[var(--cursor-text-quaternary)]",
      );
    }
  });

  it("uses semantic file-icon and sender-avatar colors", () => {
    expect(filePart).toContain(
      '<File className="h-6 w-6 text-muted-foreground" />',
    );
    expect(filePart).not.toContain('<File className="h-6 w-6 text-white" />');
    expect(senderMark).toContain(
      "bg-muted text-[9px] font-semibold text-foreground",
    );
    expect(senderMark).toContain("text-[var(--cursor-text-secondary)]");
    expect(senderMark).not.toMatch(/AvatarFallback[^\n]*text-white/);
  });

  it("does not layer low-opacity foreground colors onto readable copy", () => {
    expect(cli).not.toMatch(/text-foreground\/(?:72|85|90)/);
    expect(editor).not.toMatch(/text-foreground\/(?:80|85)/);
    expect(editor).not.toContain("text-muted-foreground/80");
    expect(titlebar).not.toContain("text-foreground/75");
    expect(settings).not.toMatch(/text-foreground\/(?:80|90)/);
    expect(workbench).not.toMatch(/text-foreground\/(?:60|65|90)/);
    expect(workbench).not.toContain('className="text-foreground/75"');
    expect(workbench).not.toContain("text-workbench-text/70");
    expect(statusBar).not.toContain('className="text-foreground/75"');
  });

  it("keeps decorative, hover, and disabled opacity treatments intact", () => {
    expect(cli).toContain('aria-hidden className="text-workbench-faint"');
    expect(editor).toContain("text-muted-foreground/30");
    expect(editor).toContain("motion-safe:animate-spin text-foreground/65");
    expect(editor).toContain("group-hover:opacity-100");
    expect(sidebar).toContain("disabled:opacity-55");
    expect(sidebar).toContain("disabled:opacity-60");
    expect(workbench).toContain("text-muted-foreground/35");
    expect(workbench).toContain('markClassName="opacity-90"');
    expect(workbench).toContain('markClassName="text-foreground/75"');
    expect(statusBar).toContain('markClassName="text-foreground/75"');
    // Two separators between the brand/mode/sandbox segments, plus the ":" that
    // divides key from action in each shortcut hint.
    expect(statusBar.match(/text-muted-foreground\/40/g)).toHaveLength(3);
  });
});
