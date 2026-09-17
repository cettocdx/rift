import { invalidateDesktopTerminalOwner } from "./desktop-terminal-owner";
import { isTauriEnvironment } from "@/app/hooks/useTauri";

export const DESKTOP_LOCAL_ACCESS_CHANGED_EVENT =
  "rift:desktop-local-access-changed";

export type DesktopWorkspaceGrant = {
  grantId: string;
  name: string;
  rootPath?: string;
  kind?: "directory" | "file";
  relativePath?: string;
  writable: boolean;
  grantedAt: number;
};

export type DesktopWorkspaceEntry = {
  name: string;
  relativePath: string;
  kind: "directory" | "file" | "other";
  size: number | null;
};

export type DesktopWorkspaceFile = {
  relativePath: string;
  mediaType: string;
  encoding: "utf8" | "base64";
  content: string;
  size: number;
  version?: string;
};

export type DesktopLoopbackResponse = {
  status: number;
  finalUrl: string;
  contentType: string;
  encoding: "utf8" | "base64";
  body: string;
  bytes: number;
  truncated: boolean;
};

async function nativeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriEnvironment()) {
    throw new Error("Desktop local access is available only in RIFT Desktop.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function publishGrantChange(): Promise<DesktopWorkspaceGrant[]> {
  const grants = await listDesktopWorkspaceGrants();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<DesktopWorkspaceGrant[]>(
        DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
        { detail: grants },
      ),
    );
  }
  return grants;
}

export async function requestDesktopWorkspaceAccess(options: {
  writable: boolean;
}): Promise<DesktopWorkspaceGrant | null> {
  if (!isTauriEnvironment()) return null;
  const grant = await nativeInvoke<DesktopWorkspaceGrant | null>(
    "request_workspace_access",
    { writable: options.writable },
  );
  if (grant) await publishGrantChange();
  return grant;
}

/** Grants access to the selected original file, never its parent folder. */
export async function requestDesktopFileAccess(): Promise<DesktopWorkspaceGrant | null> {
  if (!isTauriEnvironment()) return null;
  const grant = await nativeInvoke<DesktopWorkspaceGrant | null>(
    "request_file_access",
  );
  if (grant) await publishGrantChange();
  return grant;
}

/** Outside the native app there are no grants, so this intentionally returns []. */
export async function listDesktopWorkspaceGrants(): Promise<
  DesktopWorkspaceGrant[]
> {
  if (!isTauriEnvironment()) return [];
  return nativeInvoke<DesktopWorkspaceGrant[]>("list_workspace_grants");
}

export async function revokeDesktopWorkspaceAccess(
  grantId: string,
): Promise<boolean> {
  if (!isTauriEnvironment()) return false;
  const revoked = await nativeInvoke<boolean>("revoke_workspace_access", {
    grantId,
  });
  if (revoked) await publishGrantChange();
  return revoked;
}

export async function listDesktopWorkspaceEntries(options: {
  grantId: string;
  relativePath?: string;
}): Promise<DesktopWorkspaceEntry[]> {
  return nativeInvoke<DesktopWorkspaceEntry[]>("list_workspace_entries", {
    grantId: options.grantId,
    relativePath: options.relativePath ?? "",
  });
}

export async function readDesktopWorkspaceFile(options: {
  grantId: string;
  relativePath: string;
}): Promise<DesktopWorkspaceFile> {
  return nativeInvoke<DesktopWorkspaceFile>("read_workspace_file", options);
}

export async function writeDesktopWorkspaceFile(options: {
  grantId: string;
  relativePath: string;
  content: string;
  encoding?: "utf8" | "base64";
  expectedVersion?: string;
}): Promise<{ relativePath: string; size: number; version?: string }> {
  return nativeInvoke("write_workspace_file", {
    ...options,
    encoding: options.encoding ?? "utf8",
  });
}

export async function fetchDesktopLoopbackUrl(options: {
  url: string;
  method?: "GET" | "HEAD";
}): Promise<DesktopLoopbackResponse> {
  return nativeInvoke<DesktopLoopbackResponse>("fetch_loopback_url", {
    url: options.url,
    method: options.method ?? "GET",
  });
}

/** Opens a visible default-browser page only after a native confirmation. */
export async function openDesktopVisibleUrlWithConsent(
  url: string,
): Promise<boolean> {
  return nativeInvoke<boolean>("open_visible_url_with_consent", { url });
}

export type DesktopAccessStatus = {
  localWeb: boolean;
  computer: boolean;
  screenRecording: boolean;
  accessibility: boolean;
  supported: boolean;
};
export async function getDesktopAccessStatus(): Promise<DesktopAccessStatus> {
  return nativeInvoke<DesktopAccessStatus>("desktop_access_status");
}
export async function setDesktopAccess(
  capability: "local_web" | "computer",
  enabled: boolean,
): Promise<DesktopAccessStatus> {
  const status = await nativeInvoke<DesktopAccessStatus>("set_desktop_access", {
    capability,
    enabled,
  });
  window.dispatchEvent(new Event(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT));
  return status;
}

/** Revoke device grants when the signed-in desktop session ends. */
export async function disconnectDesktopCapabilities(): Promise<void> {
  invalidateDesktopTerminalOwner();
  try {
    await nativeInvoke("revoke_all_desktop_access");
  } catch (error) {
    const message = error instanceof Error ? error.message : error;
    // Older installed shells predate the atomic session-reset command. Match
    // only Tauri's unknown-command responses, never permission or runtime errors.
    if (
      message !== "Command revoke_all_desktop_access not found" &&
      message !== "revoke_all_desktop_access not allowed. Command not found"
    ) {
      throw error;
    }
    const results = await Promise.allSettled([
      nativeInvoke("set_desktop_access", {
        capability: "local_web",
        enabled: false,
      }),
      nativeInvoke("set_desktop_access", {
        capability: "computer",
        enabled: false,
      }),
      (async () => {
        const grants = await nativeInvoke<DesktopWorkspaceGrant[]>(
          "list_workspace_grants",
        );
        const revoked = await Promise.allSettled(
          grants.map(({ grantId }) =>
            nativeInvoke("revoke_workspace_access", { grantId }),
          ),
        );
        for (const result of revoked) {
          if (result.status === "rejected") throw result.reason;
        }
      })(),
    ]);
    // Complete independent revocations even if one fails, then report failure.
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
  }
  window.dispatchEvent(
    new CustomEvent<DesktopWorkspaceGrant[]>(
      DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
      {
        detail: [],
      },
    ),
  );
}

/** Only fixed macOS privacy panes can be opened by this command. */
export async function openDesktopPermissionSettings(
  permission: "screen_recording" | "accessibility",
): Promise<void> {
  await nativeInvoke("open_desktop_permission_settings", { permission });
}
