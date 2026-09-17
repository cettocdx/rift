"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useProShell } from "@/app/components/pro/ProShellContext";
import {
  resolveExternalSettingsAlias,
  resolveSettingsSection,
  settingsHref,
  type SettingsSectionId,
} from "@/lib/settings/registry";

/**
 * Settings is a route, so "open settings" is a navigation. The base path comes
 * from the shell, which is what keeps ⌘, inside the IDE at /lab/app rather than
 * throwing away its file tree and terminal for a settings page.
 */
export function useSettingsNavigation() {
  const router = useRouter();
  const { basePath } = useProShell();

  const hrefFor = useCallback(
    (section?: SettingsSectionId | null) => settingsHref(basePath, section),
    [basePath],
  );

  /** Accepts a section id, a label, or any legacy dialog tab name. */
  const hrefForTab = useCallback(
    (tab?: string | null) => {
      const external = resolveExternalSettingsAlias(tab);
      if (external) return external;
      return settingsHref(basePath, resolveSettingsSection(tab));
    },
    [basePath],
  );

  const openSettings = useCallback(
    (tab?: string | null) => router.push(hrefForTab(tab)),
    [hrefForTab, router],
  );

  return { basePath, hrefFor, hrefForTab, openSettings };
}
