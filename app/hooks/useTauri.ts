"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { hasAuthenticatedBefore } from "@/lib/utils/client-storage";
import { isDesktopAuthState } from "@/lib/desktop-auth-flow";

export const DESKTOP_UPDATE_URL =
  "https://github.com/rift-tech/rift/releases/latest";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const LITE_STORAGE_KEY = "rift_desktop_lite";

function detectTauri(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  // The RIFT Desktop "lite" wrapper is a thin native window around the cloud
  // app. It opts out of native desktop features (local sandbox bridge, command
  // server, desktop-only agent routing) and behaves exactly like the web
  // client — avoiding "desktop sandbox failed / update desktop" errors for a
  // bridge it does not ship. Full native desktop builds never signal lite.
  //
  // Signal channels, in order of reliability on remote URLs:
  //   1. RIFTWrapperLite user-agent marker (present on every request, client
  //      AND server, every navigation — the most deterministic signal).
  //   2. ?rift_desktop=lite query param (persisted to localStorage so the
  //      opt-out survives navigation + relaunch).
  //   3. window.__RIFT_DESKTOP_LITE__ init-script flag (backup).
  try {
    if (window.navigator?.userAgent?.includes("RIFTWrapperLite")) {
      return false;
    }
  } catch {
    /* ignore UA access errors */
  }

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("rift_desktop") === "lite") {
      try {
        window.localStorage.setItem(LITE_STORAGE_KEY, "1");
      } catch {
        /* storage unavailable — query param already proves lite mode */
      }
      return false;
    }
    try {
      if (window.localStorage.getItem(LITE_STORAGE_KEY) === "1") {
        return false;
      }
    } catch {
      /* ignore storage errors */
    }
  } catch {
    /* ignore URL parse errors */
  }

  if (
    (window as unknown as { __RIFT_DESKTOP_LITE__?: boolean })
      .__RIFT_DESKTOP_LITE__ === true
  ) {
    return false;
  }

  return window.__TAURI_INTERNALS__ !== undefined;
}

export function isTauriEnvironment(): boolean {
  return detectTauri();
}

export function useTauri(): { isTauri: boolean } {
  const isTauri = detectTauri();
  return { isTauri };
}

/**
 * Whether this is the desktop shell, for decisions that change what RENDERS.
 *
 * `detectTauri()` reads `window`, so calling it during render answers false on
 * the server and true in the desktop client -- a hydration mismatch, and React
 * resolves those by discarding the client render, which is exactly the wrong
 * outcome for chrome the user is looking at. Deciding after mount costs one
 * extra paint on desktop and is correct on both shells.
 *
 * Use `isTauriEnvironment()` for anything that only runs in an event handler or
 * an effect; this is for markup.
 */
const subscribeToNothing = () => () => {};
const readDesktopShell = () => detectTauri();
/** The shell cannot change under a mounted app, so the server always says web. */
const desktopShellServerSnapshot = () => false;

export function useIsDesktopShell(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    readDesktopShell,
    desktopShellServerSnapshot,
  );
}

export async function openInBrowser(url: string): Promise<boolean> {
  if (!detectTauri()) {
    return false;
  }

  try {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.openUrl(url);
    return true;
  } catch (err) {
    console.error("[Tauri] Failed to open URL in browser:", url, err);
    return false;
  }
}

type AuthFallbackPath =
  | "/login"
  | "/signup"
  | `/login?${string}`
  | `/signup?${string}`;

type NavigateToAuthOptions = {
  preferSignInForReturningUser?: boolean;
};

function resolveAuthPath(
  fallbackPath: AuthFallbackPath,
  options?: NavigateToAuthOptions,
): AuthFallbackPath {
  if (!options?.preferSignInForReturningUser || !hasAuthenticatedBefore()) {
    return fallbackPath;
  }

  const authUrl = new URL(fallbackPath, window.location.origin);
  if (authUrl.pathname !== "/signup") {
    return fallbackPath;
  }

  authUrl.pathname = "/login";
  return `${authUrl.pathname}${authUrl.search}` as AuthFallbackPath;
}

export async function navigateToAuth(
  fallbackPath: AuthFallbackPath,
  options?: NavigateToAuthOptions,
): Promise<void> {
  const resolvedPath = resolveAuthPath(fallbackPath, options);

  if (detectTauri()) {
    try {
      let loginUrl = `${window.location.origin}/desktop-login`;
      const fallbackUrl = new URL(resolvedPath, window.location.origin);
      const authSearchParams = new URLSearchParams(fallbackUrl.search);
      let invoke: <T>(
        cmd: string,
        args?: Record<string, unknown>,
      ) => Promise<T>;

      try {
        ({ invoke } = await import("@tauri-apps/api/core"));
      } catch (err) {
        console.error("[Tauri] Failed to load Tauri invoke API:", err);
        // No Tauri invoke bridge in this build — sign in directly inside the
        // app webview (Password auth needs no external redirect).
        window.location.href = resolvedPath;
        return;
      }

      try {
        const desktopAuthState = await invoke<string>(
          "prepare_desktop_auth_state",
        );
        if (!isDesktopAuthState(desktopAuthState)) {
          throw new Error("Desktop auth state has an invalid format");
        }
        authSearchParams.set("desktop_state", desktopAuthState);
      } catch (err) {
        console.error("[Tauri] Failed to prepare desktop auth state:", err);
        // No desktop sign-in bridge available — fall back to signing in
        // directly inside the app webview instead of prompting an update.
        window.location.href = resolvedPath;
        return;
      }

      if (fallbackUrl.pathname === "/signup") {
        authSearchParams.set("screen_hint", "sign-up");
      }

      // In dev mode, pass the local auth callback port so the server
      // redirects to localhost instead of the rift:// deep link
      try {
        const port = await invoke<number>("get_dev_auth_port");
        if (port > 0) {
          authSearchParams.set("dev_callback_port", String(port));
        }
      } catch {
        // Not in dev mode or command not available
      }

      const query = authSearchParams.toString();
      if (query) {
        loginUrl += `?${query}`;
      }

      const opened = await openInBrowser(loginUrl);
      if (opened) return;
    } catch {
      // Fall through to web navigation
    }
  }
  window.location.href = resolvedPath;
}

/**
 * Get the local command execution server info (port + auth token).
 * Returns null if not in Tauri or server not started.
 */
export async function getCmdServerInfo(): Promise<{
  port: number;
  token: string;
} | null> {
  if (!detectTauri()) {
    return null;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{
      port: number;
      token: string;
    }>("get_cmd_server_info");
    if (info.port > 0 && info.token) {
      return info;
    }
    return null;
  } catch {
    return null;
  }
}

export type LocalFileMetadata = {
  path: string;
  name: string;
  mediaType: string;
  size: number;
  lastModified: number;
};

export type LocalFileData = LocalFileMetadata & {
  base64: string;
};

export async function pickLocalFiles(): Promise<string[]> {
  if (!detectTauri()) return [];

  try {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const selected = await dialog.open({
      multiple: true,
      directory: false,
    });
    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
  } catch (err) {
    console.error("[Tauri] Failed to pick local files:", err);
    toast.error("Failed to open file picker");
    return [];
  }
}

export async function getLocalFileMetadata(
  path: string,
): Promise<LocalFileMetadata | null> {
  if (!detectTauri()) return null;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<LocalFileMetadata>("get_local_file_metadata", {
      path,
    });
  } catch (err) {
    console.error("[Tauri] Failed to read local file metadata:", err);
    toast.error("Failed to read local file metadata");
    return null;
  }
}

export async function readLocalFile(
  path: string,
): Promise<LocalFileData | null> {
  if (!detectTauri()) return null;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<LocalFileData>("read_local_file", {
      path,
    });
  } catch (err) {
    console.error("[Tauri] Failed to read local file:", err);
    toast.error("Failed to read local file");
    return null;
  }
}

/**
 * Reveal a file or folder in the OS file manager (Finder/Explorer).
 */
export async function revealFileInDir(path: string): Promise<boolean> {
  if (!detectTauri()) {
    return false;
  }

  try {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.revealItemInDir(path);
    return true;
  } catch (err) {
    console.error("[Tauri] Failed to reveal file:", path, err);
    toast.error("File not found", { description: path });
    return false;
  }
}

/** Save bounded file content directly to Downloads through native IPC. */
export async function saveFileToLocal(
  filename: string,
  content: string,
  encoding: "utf8" | "base64" = "utf8",
): Promise<string | null> {
  if (!detectTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const saved = await invoke<{ path: string; size: number }>(
      "save_file_to_downloads",
      { filename, content, encoding },
    );
    return saved.path;
  } catch (error) {
    console.error("[Tauri] Failed to save download:", error);
    return null;
  }
}

export async function openDownloadsFolder(): Promise<boolean> {
  if (!detectTauri()) {
    return false;
  }

  try {
    // Dynamic imports for Tauri plugins - only available in desktop context

    const opener = await (import("@tauri-apps/plugin-opener") as Promise<any>);

    const path = await (import("@tauri-apps/api/path") as Promise<any>);
    const downloadsPath = await path.downloadDir();
    await opener.openPath(downloadsPath);
    return true;
  } catch (err) {
    console.error("[Tauri] Failed to open Downloads folder:", err);
    return false;
  }
}
