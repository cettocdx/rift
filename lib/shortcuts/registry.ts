/**
 * Every keyboard chord the product claims to have, in one place.
 *
 * There used to be two shortcut tables and two keyboard hooks, and they
 * disagreed: one table listed seven chords, the other eight, ⌘K was advertised
 * first in a shell where it was explicitly disabled, and ⌘, was the only chord
 * without a rule about firing while you type. A table written by hand beside
 * the handler it describes will always drift from it. This is read by both
 * tables, both palettes and both hooks, so a chord that is not here does not
 * exist and a chord that is here is documented.
 */

/**
 * Where a chord applies.
 * - `everywhere`: both shells and the workspace.
 * - `app`: the chat shell, standard and Pro.
 * - `pro`: the Pro chat shell only.
 * - `standard`: the standard chat shell only.
 * - `workspace`: the CLI workspace / IDE.
 */
export type ShortcutScope =
  | "everywhere"
  | "app"
  | "pro"
  | "standard"
  | "workspace";

export interface ShortcutBinding {
  /** Command on a Mac, Ctrl elsewhere. Every chord in this product uses it. */
  mod: true;
  shift?: boolean;
  /** Lowercase `event.key`, or the literal character for punctuation. */
  key: string;
}

export interface Shortcut {
  id: string;
  label: string;
  /**
   * One surface, or several. A chord that means the same thing in two shells
   * is one entry with two scopes — duplicating it would be two rows in the
   * reference tables for one key.
   */
  scope: ShortcutScope | readonly ShortcutScope[];
  binding: ShortcutBinding;
  /**
   * What happens when focus is in a text field, an editor or a terminal.
   * `block` means the surface keeps the keystroke. Declared per chord rather
   * than decided inside each handler, which is how the settings chord ended up
   * as the only one with no rule at all.
   */
  inInput: "allow" | "block";
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: "new-session",
    label: "New session",
    scope: "everywhere",
    binding: { mod: true, key: "n" },
    // Starting a new session from inside the composer you are typing in is
    // the point of the chord, not an accident.
    inInput: "allow",
  },
  {
    id: "toggle-sidebar",
    label: "Toggle sidebar",
    scope: "everywhere",
    binding: { mod: true, key: "b" },
    inInput: "block",
  },
  {
    id: "terminal-dock",
    label: "Open the terminal dock",
    scope: "app",
    binding: { mod: true, key: "j" },
    // Reaching for a shell while you are mid-sentence in the composer is the
    // reason this chord exists, so it deliberately works from a text field.
    inInput: "allow",
  },
  {
    id: "workspace-bottom-panel",
    label: "Toggle the bottom panel",
    scope: "workspace",
    binding: { mod: true, key: "j" },
    // Same chord, same reason — and the workspace hook separately hands real
    // terminal control chords back to the terminal.
    inInput: "allow",
  },
  {
    id: "workspace-terminal-fullscreen",
    label: "Maximize the terminal",
    scope: "workspace",
    binding: { mod: true, shift: true, key: "j" },
    inInput: "allow",
  },
  {
    id: "settings",
    label: "Open settings",
    scope: "everywhere",
    binding: { mod: true, key: "," },
    // The one chord that used to have no rule. It fired from inside the
    // settings search field, which is the surface it opens.
    inInput: "block",
  },
  {
    id: "command-palette",
    label: "Open the command palette",
    scope: "everywhere",
    binding: { mod: true, shift: true, key: "p" },
    inInput: "allow",
  },
  {
    id: "command-palette-k",
    label: "Open the command palette",
    scope: ["pro", "workspace"],
    // Advertised as the first chord in the Pro shortcut list while the only
    // handler for it returned early in that shell. It works now.
    binding: { mod: true, key: "k" },
    inInput: "allow",
  },
  {
    id: "chat-search",
    label: "Search chats",
    scope: "standard",
    binding: { mod: true, key: "k" },
    inInput: "allow",
  },
] as const;

const BY_ID = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

export function getShortcut(id: string): Shortcut {
  const shortcut = BY_ID.get(id);
  if (!shortcut) throw new Error(`Unknown shortcut: ${id}`);
  return shortcut;
}

/** The chords a surface should list and handle. */
export function shortcutsForScope(
  scope: Exclude<ShortcutScope, "everywhere">,
): readonly Shortcut[] {
  return SHORTCUTS.filter((shortcut) => {
    const scopes = Array.isArray(shortcut.scope)
      ? shortcut.scope
      : [shortcut.scope as ShortcutScope];
    return scopes.some(
      (candidate) =>
        candidate === "everywhere" ||
        candidate === scope ||
        // Both chat shells inherit what applies to the app as a whole.
        (candidate === "app" && (scope === "pro" || scope === "standard")),
    );
  });
}

const KEY_LABELS: Record<string, string> = {
  ",": ",",
};

/** "⌘⇧P" on a Mac, "Ctrl+Shift+P" elsewhere. */
export function formatChord(binding: ShortcutBinding, isMac: boolean): string {
  const key = KEY_LABELS[binding.key] ?? binding.key.toUpperCase();
  if (isMac) return `⌘${binding.shift ? "⇧" : ""}${key}`;
  return `Ctrl+${binding.shift ? "Shift+" : ""}${key}`;
}

interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}

/**
 * Whether an event is this chord. `shift` is matched in both directions:
 * without that, Mod+Shift+J also counts as Mod+J, and maximizing the terminal
 * toggles the panel shut on the way.
 */
export function matchShortcut(
  shortcut: Shortcut,
  event: ShortcutEvent,
): boolean {
  const platform =
    typeof navigator === "undefined"
      ? ""
      : navigator.platform || navigator.userAgent;
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  // macOS Control chords belong to native text editing (Ctrl-N, Ctrl-K) and
  // terminal applications. Do not treat them as aliases for Command.
  if (isMac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)
    return false;
  if (event.altKey) return false;
  if (Boolean(shortcut.binding.shift) !== event.shiftKey) return false;
  return event.key.toLowerCase() === shortcut.binding.key;
}

/**
 * Text fields, editors and terminals, which own their own keystrokes. The
 * selector is shared so the chat shell and the IDE agree on what "typing"
 * means — they used to use two different lists.
 */
export const EDITABLE_SHORTCUT_TARGET_SELECTOR =
  "input, textarea, select, [contenteditable], [role='textbox'], .monaco-editor, [data-workbench-interactive-terminal]";

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(EDITABLE_SHORTCUT_TARGET_SELECTOR) !== null
  );
}

/** A chord fires when it matches and its declared input rule allows it. */
export function shortcutFires(
  shortcut: Shortcut,
  event: ShortcutEvent,
  inInput: boolean,
): boolean {
  if (!matchShortcut(shortcut, event)) return false;
  return shortcut.inInput === "allow" || !inInput;
}
