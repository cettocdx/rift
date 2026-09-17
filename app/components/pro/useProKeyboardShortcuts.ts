"use client";

import { useEffect, useRef } from "react";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import { openCommandPalette } from "@/lib/utils/command-palette";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import {
  getShortcut,
  isEditableShortcutTarget,
  shortcutFires,
} from "@/lib/shortcuts/registry";

const MOBILE_SHORTCUT_BREAKPOINT = 768;

export function useProKeyboardShortcuts() {
  const {
    toggleChatSidebar,
    initializeNewChat,
    closeSidebar,
    toggleTerminalDock,
  } = useGlobalState();
  const { goHome } = useChatNavigation();
  const { openSettings } = useSettingsNavigation();

  const menuAction = useRef<(action: string) => void>(() => {});
  useEffect(() => {
    menuAction.current = (action) => {
      if (action === "new-chat") { closeSidebar(); initializeNewChat(); goHome(); }
      else if (action === "search") openCommandPalette();
      else if (action === "settings") openSettings();
    };
  }, [closeSidebar, initializeNewChat, goHome, openSettings]);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let cancelled = false;
    let stop: (() => void | Promise<void>) | undefined;
    const dispose = async (unlisten: () => void | Promise<void>) => {
      // Native listener registration is evaluated asynchronously in WKWebView.
      // Allow that evaluation to finish before removing a late registration.
      await new Promise(resolve => setTimeout(resolve, 0));
      try { await unlisten(); }
      catch (error) { console.warn("Desktop menu listener cleanup failed", error); }
    };
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      if (cancelled) return;
      const unlisten = await listen<{ action: string }>("rift:desktop-menu-action", ({ payload }) => {
        if (!cancelled) menuAction.current(payload.action);
      });
      if (cancelled) await dispose(unlisten);
      else stop = unlisten;
    }).catch(error => console.warn("Desktop menu listener registration failed", error));
    return () => { cancelled = true; if (stop) void dispose(stop); };
  }, []);

  useEffect(() => {
    const runMenuAction = (action: string) => {
      if (action === "new-chat") {
        closeSidebar();
        initializeNewChat();
        goHome();
      } else if (action === "search") {
        openCommandPalette();
      } else if (action === "settings") {
        openSettings();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const inInput = isEditableShortcutTarget(e.target);
      const fires = (id: string) => shortcutFires(getShortcut(id), e, inInput);

      if (fires("new-session")) {
        e.preventDefault();
        runMenuAction("new-chat");
        return;
      }
      if (fires("toggle-sidebar")) {
        e.preventDefault();
        toggleChatSidebar();
        return;
      }
      if (fires("terminal-dock")) {
        if (e.repeat || window.innerWidth < MOBILE_SHORTCUT_BREAKPOINT) {
          return;
        }
        e.preventDefault();
        // This listener runs during capture. Stop this same keydown from
        // reaching the workspace listener if the route mounts before the
        // event finishes bubbling, otherwise the freshly opened panel is
        // immediately toggled closed.
        e.stopPropagation();
        // Opening the terminal used to mean leaving the page for /workspace,
        // which cost the user the conversation they were opening a shell for.
        // The dock mounts the same panel in place instead.
        toggleTerminalDock();
        return;
      }
      if (fires("settings")) {
        e.preventDefault();
        runMenuAction("settings");
        return;
      }
      if (fires("command-palette") || fires("command-palette-k")) {
        // The Pro shortcut list advertised Mod+K first while the only handler
        // for it lived in the standard shell behind an early return, so in
        // this shell it did nothing at all.
        e.preventDefault();
        runMenuAction("search");
      }
    };
    // Global shell shortcuts must run before non-editable widgets can stop the
    // bubbling keyboard event. Editable surfaces are left alone by each
    // chord's own `inInput` rule, so their native shortcuts keep working.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
    // `toggleTerminalDock` belongs here with the rest. It comes from the same
    // context as the others and its identity changes with that context, so
    // leaving it out let the listener keep calling a version of it bound to a
    // stale state — the shortcut appears to do nothing, intermittently, which
    // is the hardest kind of keyboard bug to reproduce.
  }, [
    toggleChatSidebar,
    initializeNewChat,
    closeSidebar,
    toggleTerminalDock,
    goHome,
    openSettings,
  ]);
}
