"use client";

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useWindowStripSlot } from "./pro/window-strip";
import { Globe, PanelRight, SquareTerminal } from "lucide-react";
import { CursorActivityGlyph } from "@/components/ui/cursor-thinking";
import { prepareWorkbenchPanel } from "./workbench/prepare-panel";
import type { ChatStatus, SidebarContent, Todo } from "@/types/chat";
import {
  buildAgentActivitySnapshot,
  type AgentActivityMessage,
} from "./agent-activity";

interface AgentRunSummaryBarProps {
  todos: readonly Todo[];
  toolExecutions: readonly SidebarContent[];
  messages?: readonly AgentActivityMessage[];
  status?: ChatStatus;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onToggleTerminal?: () => void;
  /** Only passed when a preview actually exists; a dead control is worse than none. */
  onTogglePreview?: () => void;
  previewOpen?: boolean;
  terminalOpen?: boolean;
  onOpenBrowser?: () => void;
  panelDestination?: "workspace" | "activity";
}

/** One size, one radius, one hover for every control in the strip. */
const STRIP_BUTTON_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--cursor-icon-secondary)] transition-colors duration-(--duration-hover) hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:bg-foreground/[0.06] aria-expanded:text-foreground";

export function AgentRunSummaryBar({
  todos,
  toolExecutions,
  messages,
  status,
  panelOpen,
  onTogglePanel,
  onToggleTerminal,
  onTogglePreview,
  previewOpen = false,
  terminalOpen = false,
  onOpenBrowser,
  panelDestination = "activity",
}: AgentRunSummaryBarProps) {
  const snapshot = useMemo(
    () =>
      buildAgentActivitySnapshot({
        todos,
        toolExecutions,
        messages,
        status,
      }),
    [messages, status, todos, toolExecutions],
  );
  const isWorking =
    status === "streaming" ||
    status === "submitted" ||
    snapshot.runningOperations > 0 ||
    snapshot.runningSubagents > 0;

  // The desktop strip is an absolutely-positioned drag overlay across the top
  // 48px of the workbench. Anything rendered *under* it in that band is
  // unclickable -- the drag region swallows the press. So the controls mount
  // into the strip itself, which also puts them in the same bar as the traffic
  // lights, the way the reference window has it. On the web there is no strip
  // and they render in place.
  const actionsSlot = useWindowStripSlot("rift-window-actions-slot");

  // Once a desktop dock is visible, its header owns tab navigation and hiding.
  // Keeping these launchers mounted behind it creates duplicate focus targets
  // and stacked close controls in the inline/browser layout.
  if (panelDestination === "workspace" && panelOpen) return null;
  const prepare = (kind: Parameters<typeof prepareWorkbenchPanel>[0]) => {
    if (panelDestination === "workspace") prepareWorkbenchPanel(kind);
  };

  // Activity is a persistent workspace destination, including plain-text
  // replies and idle chats. Only an explicit click opens it.

  const controls = (
    <div
      data-ui="workspace-strip"
      className="flex shrink-0 items-center justify-end gap-0.5"
    >
      {onOpenBrowser && (
        <button
          type="button"
          onClick={onOpenBrowser}
          onPointerEnter={() => prepare("browser")}
          onFocus={() => prepare("browser")}
          aria-label="Open browser"
          title="Open browser"
          className={STRIP_BUTTON_CLASS}
        >
          <Globe className="size-[15px]" aria-hidden strokeWidth={1.6} />
        </button>
      )}
      {onToggleTerminal ? (
        <button
          type="button"
          onClick={onToggleTerminal}
          onPointerEnter={() => prepare("terminal")}
          onFocus={() => prepare("terminal")}
          aria-expanded={terminalOpen}
          aria-label={terminalOpen ? "Hide terminal" : "Show terminal"}
          title={terminalOpen ? "Hide terminal" : "Show terminal"}
          className={STRIP_BUTTON_CLASS}
        >
          <SquareTerminal
            className="size-[15px]"
            aria-hidden
            strokeWidth={1.6}
          />
        </button>
      ) : null}

      {onTogglePreview ? (
        <button
          type="button"
          onClick={onTogglePreview}
          onPointerEnter={() => prepare("preview")}
          onFocus={() => prepare("preview")}
          aria-expanded={previewOpen}
          aria-label={previewOpen ? "Hide preview" : "Show preview"}
          title={previewOpen ? "Hide preview" : "Show preview"}
          className={STRIP_BUTTON_CLASS}
        >
          <Globe className="size-[15px]" aria-hidden strokeWidth={1.6} />
        </button>
      ) : null}

      <button
        type="button"
        onClick={onTogglePanel}
        onPointerEnter={() => prepare("activity")}
        onFocus={() => prepare("activity")}
        aria-expanded={panelOpen}
        aria-controls={
          panelDestination === "workspace"
            ? "rift-build-tool-pane"
            : "agent-activity-panel"
        }
        aria-label={
          panelDestination === "workspace"
            ? panelOpen
              ? "Hide workspace panel"
              : "Show workspace panel"
            : panelOpen
              ? "Hide agent activity"
              : "Show agent activity"
        }
        title={
          panelDestination === "workspace"
            ? panelOpen
              ? "Hide panel"
              : "Show panel"
            : panelOpen
              ? "Hide agent activity"
              : "Show agent activity"
        }
        className={STRIP_BUTTON_CLASS}
      >
        {/* The spinner replaces the icon while a run is live: the one place
              this strip carries status rather than just navigation. */}
        {isWorking && !panelOpen ? (
          <CursorActivityGlyph active />
        ) : (
          <PanelRight className="size-[15px]" aria-hidden strokeWidth={1.6} />
        )}
      </button>
    </div>
  );

  if (actionsSlot) return createPortal(controls, actionsSlot);
  return <div className="flex shrink-0 justify-end px-2 py-1">{controls}</div>;
}
