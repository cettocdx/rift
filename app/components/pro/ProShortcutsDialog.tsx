"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMac } from "@/app/hooks/useIsMac";
import { formatChord, shortcutsForScope } from "@/lib/shortcuts/registry";

/**
 * Composer chords. They are not in the shortcut registry because they are not
 * global chords with handlers — they are characters the composer reacts to.
 */
const COMPOSER_KEYS = [
  ["@", "Context picker in the composer"],
  ["/", "Slash commands and operations"],
] as const;

const EVENT = "rift:open-shortcuts";

export function openShortcutsDialog() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function ProShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const isMac = useIsMac();
  // Same source as the settings reference and the handlers themselves, so this
  // list cannot advertise a chord the shell does not act on. It used to lead
  // with Mod+K, which this shell explicitly ignored.
  const shortcuts = shortcutsForScope("pro");
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="pro-dropdown sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription className="sr-only">
            Review the keyboard shortcuts available in the RIFT workbench.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 pt-2">
          {shortcuts.map((shortcut) => (
            <li
              key={shortcut.id}
              data-shortcut-id={shortcut.id}
              className="flex items-center justify-between text-ui"
            >
              <span className="text-muted-foreground">{shortcut.label}</span>
              <kbd className="rounded border border-border-strong bg-muted/45 px-2 py-0.5 font-mono text-ui-caption text-foreground/85">
                {formatChord(shortcut.binding, isMac)}
              </kbd>
            </li>
          ))}
          {COMPOSER_KEYS.map(([key, description]) => (
            <li key={key} className="flex items-center justify-between text-ui">
              <span className="text-muted-foreground">{description}</span>
              <kbd className="rounded border border-border-strong bg-muted/45 px-2 py-0.5 font-mono text-ui-caption text-foreground/85">
                {key}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
