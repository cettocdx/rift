"use client";

import { useGlobalState } from "@/app/contexts/GlobalState";
import { useHydrated } from "@/app/hooks/useHydrated";
import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import { useProShell } from "./ProShellContext";

export function ProStatusBar() {
  const hydrated = useHydrated();
  const { enabled } = useProShell();
  const { chatMode, sandboxPreference, sidebarOpen } = useGlobalState();
  if (!enabled) return null;

  const visibleChatMode = hydrated ? chatMode : "ask";
  const visibleSandbox = hydrated ? sandboxPreference : "cloud";
  const visibleSidebarOpen = hydrated ? sidebarOpen : false;

  return (
    <footer className="pro-status-bar flex h-7 shrink-0 items-center gap-2 border-t border-sidebar-border px-3 text-ui-label text-muted-foreground">
      <RiftBrandLockup
        markSize={13}
        textSize={11}
        gap={4}
        markClassName="text-foreground/75"
        textClassName="text-[var(--pro-text-secondary)]"
      />
      <span aria-hidden className="text-muted-foreground/40">
        /
      </span>
      <span>{visibleChatMode ?? "ask"}</span>
      <span aria-hidden className="text-muted-foreground/40">
        ·
      </span>
      <span>{visibleSandbox ?? "cloud"}</span>
      <span className="ml-auto flex items-center gap-3">
        {visibleSidebarOpen ? <span>tools open</span> : null}
        {/* Only bindings that actually exist: ⌘K ProCommandPalette, ⌘B and ⌘N
            useProKeyboardShortcuts. Advertising a key that does nothing is
            worse than showing no hint at all. */}
        <span className="hidden items-center gap-3 font-mono sm:flex">
          {[
            { keys: "⌘K", label: "commands" },
            { keys: "⌘B", label: "sidebar" },
            { keys: "⌘N", label: "new" },
          ].map((shortcut) => (
            <span key={shortcut.keys}>
              <span className="text-[var(--cursor-text-secondary)]">
                {shortcut.keys}
              </span>
              <span aria-hidden className="text-muted-foreground/40">
                :
              </span>
              {shortcut.label}
            </span>
          ))}
        </span>
      </span>
    </footer>
  );
}
