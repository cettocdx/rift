"use client";

import { useCallback, useEffect } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_STORAGE_KEY,
  applyAppearanceConfig,
  loadAppearanceConfig,
  type AppearanceConfig,
} from "@/lib/appearance/presets";

function AppearanceRuntime() {
  const { resolvedTheme } = useTheme();
  const applyStoredAppearance = useCallback(
    (config?: AppearanceConfig) => {
      applyAppearanceConfig(config ?? loadAppearanceConfig(), resolvedTheme);
    },
    [resolvedTheme],
  );

  useEffect(() => {
    applyStoredAppearance();
  }, [applyStoredAppearance]);

  useEffect(() => {
    if (!resolvedTheme) return;
    // Safari's surrounding chrome follows the app's selected theme, which can
    // differ from the device preference. Keep one authoritative color tag.
    let meta = document.head.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }
    meta.content = resolvedTheme === "dark" ? "#000000" : "#ffffff";
  }, [resolvedTheme]);

  useEffect(() => {
    if (!isTauriEnvironment() || !resolvedTheme) return;
    let cancelled = false;
    // Match native dialogs, traffic lights and window materials to the web UI.
    // Older desktop builds can keep rendering while they await an update.
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        if (cancelled) return;
        return invoke("set_desktop_theme", {
          theme: resolvedTheme === "dark" ? "dark" : "light",
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const handleAppearanceChange = (event: Event) => {
      const customEvent = event as CustomEvent<AppearanceConfig>;
      applyStoredAppearance(customEvent.detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === APPEARANCE_STORAGE_KEY) {
        applyStoredAppearance();
      }
    };
    window.addEventListener(APPEARANCE_CHANGE_EVENT, handleAppearanceChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(
        APPEARANCE_CHANGE_EVENT,
        handleAppearanceChange,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, [applyStoredAppearance]);

  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
    >
      <AppearanceRuntime />
      {children}
    </NextThemesProvider>
  );
}
