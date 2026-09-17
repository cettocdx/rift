"use client";

import { Command } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openCommandPalette } from "@/lib/utils/command-palette";
import { useIsMac } from "@/app/hooks/useIsMac";
import { useProShell } from "@/app/components/pro/ProShellContext";
import {
  shortcutsForScope,
  formatChord,
  type Shortcut,
  type ShortcutScope,
} from "@/lib/shortcuts/registry";

const SCOPE_LABELS: Record<ShortcutScope, string> = {
  everywhere: "Everywhere",
  app: "App",
  pro: "App",
  standard: "App",
  workspace: "Workspace",
};

/** A chord can apply to more than one surface; name them all. */
function scopeLabel(scope: Shortcut["scope"]): string {
  const scopes: readonly ShortcutScope[] = Array.isArray(scope)
    ? scope
    : [scope as ShortcutScope];
  return [...new Set(scopes.map((entry) => SCOPE_LABELS[entry]))].join(" and ");
}

interface KeyboardSettingsTabProps {
  onOpenPalette: () => void;
}

export function KeyboardSettingsTab({
  onOpenPalette,
}: KeyboardSettingsTabProps) {
  const isMac = useIsMac();
  const { enabled, basePath } = useProShell();
  const shortcuts = shortcutsForScope(
    basePath === "/workspace" ? "workspace" : enabled ? "pro" : "standard",
  );
  const handleOpenPalette = () => {
    onOpenPalette();
    requestAnimationFrame(() => openCommandPalette());
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="keyboard-shortcuts-heading">
        <div className="flex items-start justify-between gap-4 max-[460px]:flex-col max-[460px]:gap-2">
          <div>
            <h4 id="keyboard-shortcuts-heading" className="text-ui font-medium">
              Keyboard shortcuts
            </h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Move between tools without leaving the keyboard. These shortcuts
              are available in your current view.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1.5 self-start whitespace-nowrap text-ui-caption"
            onClick={handleOpenPalette}
          >
            <Command className="size-3" aria-hidden />
            Open palette
          </Button>
        </div>

        {/* Read-only reference: a definition list, not a list of controls.
            There is nothing here to click, so nothing here takes focus or a
            pointer cursor. */}
        <dl className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border">
          {shortcuts.map((shortcut) => (
            <div
              key={shortcut.id}
              data-shortcut-id={shortcut.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <dt className="truncate text-ui-label text-foreground/90">
                  {shortcut.label}
                </dt>
                <dd className="text-ui-caption text-muted-foreground">
                  {scopeLabel(shortcut.scope)}
                </dd>
              </div>
              <dd>
                <kbd className="rounded border border-border-strong bg-muted/45 px-1.5 py-0.5 font-mono text-ui-caption text-muted-foreground">
                  {formatChord(shortcut.binding, isMac)}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="notification-settings-heading">
        <h4 id="notification-settings-heading" className="text-ui font-medium">
          Notifications
        </h4>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Task completion and errors appear inside RIFT. Manage browser and
          desktop notification permissions in your system settings.
        </p>
      </section>
    </div>
  );
}
