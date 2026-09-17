"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { CODEX_NATIVE_UI_STYLE } from "./page-shell/CodexPageShell";

const McpMarketplace = dynamic(
  () => import("./McpMarketplace").then((module) => module.McpMarketplace),
  { loading: ExtensionPanelLoading },
);
const SkillsPanel = dynamic(
  () => import("./SkillsPanel").then((module) => module.SkillsPanel),
  { loading: ExtensionPanelLoading },
);

const TABS = [
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function ExtensionPanelLoading() {
  return (
    <div
      className="flex h-full min-h-40 items-center justify-center text-ui-label text-muted-foreground"
      role="status"
    >
      Loading extensions…
    </div>
  );
}

function ExtensionTabs({
  tab,
  onSelect,
}: {
  tab: TabId;
  onSelect: (tab: TabId) => void;
}) {
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    current: TabId,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = TABS.findIndex((item) => item.id === current);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? TABS.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % TABS.length
            : (currentIndex - 1 + TABS.length) % TABS.length;
    const next = TABS[nextIndex];
    if (!next) return;
    onSelect(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <div
      className="flex w-fit items-center gap-0.5 rounded-lg border border-border/75 bg-card/[0.14] p-0.5"
      role="tablist"
      aria-label="Extensions"
    >
      {TABS.map((item) => {
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[item.id] = node;
            }}
            type="button"
            id={`extensions-tab-${item.id}`}
            role="tab"
            aria-selected={active}
            aria-controls={`extensions-panel-${item.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => handleKeyDown(event, item.id)}
            className={`min-h-11 touch-manipulation rounded-md px-3 text-ui-label font-medium transition-colors duration-(--duration-hover) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background md:pointer-fine:h-7 md:pointer-fine:min-h-0 ${
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/55 hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The Plugins/Skills workbench — a Codex-style tab switcher at the top of the
 * main content area, hosting the MCP connector marketplace and the skills
 * marketplace.
 */
export function PluginsWorkbench() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: TabId =
    searchParams.get("tab") === "skills" ? "skills" : "plugins";
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<TabId>>(
    () => new Set([tab]),
  );
  if (!visitedTabs.has(tab)) {
    setVisitedTabs(new Set([...visitedTabs, tab]));
  }

  const selectTab = (next: TabId) => {
    router.replace(next === "skills" ? "/plugins?tab=skills" : "/plugins", {
      scroll: false,
    });
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      style={CODEX_NATIVE_UI_STYLE}
    >
      <div className="shrink-0 border-b border-border/60">
        <div className="rift-page-frame py-3">
          <ExtensionTabs tab={tab} onSelect={selectTab} />
        </div>
      </div>
      {TABS.map((item) => {
        const active = tab === item.id;
        if (!active && !visitedTabs.has(item.id)) return null;
        return (
          <div
            key={item.id}
            id={`extensions-panel-${item.id}`}
            role="tabpanel"
            aria-labelledby={`extensions-tab-${item.id}`}
            className="min-h-0 flex-1"
            hidden={!active}
            inert={!active}
            aria-hidden={!active}
          >
            {item.id === "plugins" ? (
              <McpMarketplace active={active} />
            ) : (
              <SkillsPanel active={active} />
            )}
          </div>
        );
      })}
    </div>
  );
}
