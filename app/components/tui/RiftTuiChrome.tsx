"use client";

import { useSyncExternalStore } from "react";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { getEffectiveBuildModel } from "@/types/chat";

/**
 * The chrome line a terminal agent keeps under its prompt: what the keys do,
 * and how much of the model's context the work is using.
 *
 * Rendered only under the TUI skin (RIFT_UI_SKIN=tui). Everything shown is read
 * from state the shell already holds, and only bindings that actually exist are
 * advertised: ⌘K opens the command palette (ProCommandPalette), ⌘B toggles the
 * sidebar and ⌘N starts a chat (useProKeyboardShortcuts).
 */

const SHORTCUTS = [
  { keys: "⌘K", action: "commands" },
  { keys: "⌘B", action: "sidebar" },
  { keys: "⌘N", action: "new" },
] as const;

const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return `${tokens}`;
};

/**
 * The skin is stamped on <html> by the server. Read through an external store
 * rather than an effect: the value never changes for the life of the document,
 * and the server snapshot keeps hydration honest instead of flashing.
 */
const subscribeToSkin = () => () => {};
const getSkinSnapshot = () => document.documentElement.dataset.uiSkin === "tui";
const getSkinServerSnapshot = () => false;

export function useTuiSkin(): boolean {
  return useSyncExternalStore(
    subscribeToSkin,
    getSkinSnapshot,
    getSkinServerSnapshot,
  );
}

export function RiftTuiChrome({ contextUsed = 0 }: { contextUsed?: number }) {
  const { selectedModel } = useGlobalState();
  const model = getEffectiveBuildModel(selectedModel);

  return (
    <div data-ui="tui-chrome" data-edge="bottom">
      {SHORTCUTS.map((shortcut) => (
        <span key={shortcut.keys}>
          <span className="text-[var(--cursor-text-secondary)]">
            {shortcut.keys}
          </span>
          <span aria-hidden className="text-muted-foreground/40">
            :
          </span>
          {shortcut.action}
        </span>
      ))}
      <span className="ml-auto tabular-nums" title="Context used / window">
        {contextUsed > 0 ? (
          <>
            <span className="text-foreground">{formatTokens(contextUsed)}</span>
            <span aria-hidden className="text-muted-foreground/40">
              {" / "}
            </span>
          </>
        ) : null}
        {formatTokens(model.contextTokens)}
      </span>
    </div>
  );
}
