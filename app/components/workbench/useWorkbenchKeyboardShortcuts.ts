"use client";

import { useEffect } from "react";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import { openCommandPalette } from "@/lib/utils/command-palette";
import {
  getShortcut,
  isEditableShortcutTarget,
  shortcutFires,
} from "@/lib/shortcuts/registry";
import { useWorkbench } from "./WorkbenchProvider";
import { shouldPreserveTerminalCtrlChord } from "./terminal-keyboard-target";

export function useWorkbenchKeyboardShortcuts() {
  const { actions } = useWorkbench();
  const toggleSidebar = actions.toggleSidebar;
  const toggleBottomPanel = actions.toggleBottomPanel;
  const toggleTerminalFullscreen = actions.toggleTerminalFullscreen;
  const { initializeNewChat, closeSidebar } = useGlobalState();
  const { goHome } = useChatNavigation();
  const { openSettings } = useSettingsNavigation();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (shouldPreserveTerminalCtrlChord(event)) return;

      const inInput = isEditableShortcutTarget(event.target);
      const fires = (id: string) =>
        shortcutFires(getShortcut(id), event, inInput);

      if (fires("new-session")) {
        event.preventDefault();
        closeSidebar();
        initializeNewChat();
        goHome();
        return;
      }
      if (fires("toggle-sidebar")) {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (fires("workspace-terminal-fullscreen")) {
        event.preventDefault();
        toggleTerminalFullscreen();
        return;
      }
      if (fires("workspace-bottom-panel")) {
        event.preventDefault();
        toggleBottomPanel();
        return;
      }
      if (fires("settings")) {
        event.preventDefault();
        openSettings();
        return;
      }
      if (fires("command-palette") || fires("command-palette-k")) {
        // The palette used to listen for its own chords, which meant two
        // handlers for one key once the shell started reading the registry:
        // one opened it and the other toggled it shut again.
        event.preventDefault();
        openCommandPalette();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    toggleSidebar,
    toggleBottomPanel,
    toggleTerminalFullscreen,
    initializeNewChat,
    closeSidebar,
    goHome,
    openSettings,
  ]);
}
