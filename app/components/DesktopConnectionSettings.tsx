"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe2, Monitor, LoaderCircle } from "lucide-react";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import {
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
  getDesktopAccessStatus,
  openDesktopPermissionSettings,
  type DesktopAccessStatus,
} from "@/app/services/desktop-local-access";

export function DesktopConnectionSettings() {
  const [status, setStatus] = useState<DesktopAccessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(false);
  const refresh = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    try {
      setStatus(await getDesktopAccessStatus());
      setError(null);
    } catch {
      setError(
        "Reconnect RIFT Desktop. If device connections remain unavailable, update the desktop app.",
      );
    }
  }, []);
  useEffect(() => {
    setDesktop(isTauriEnvironment());
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, refresh);
    };
  }, [refresh]);
  async function openPermission(
    permission: "screen_recording" | "accessibility",
  ) {
    setBusy(permission);
    setError(null);
    try {
      await openDesktopPermissionSettings(permission);
    } catch {
      setError(
        "Could not open macOS permissions. Open Privacy & Security in System Settings.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section
      className="rounded-xl border border-border bg-background text-[13px]"
      aria-label="Desktop connections"
    >
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-medium text-foreground">This Mac</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Local websites and computer control are available automatically while
          signed in. macOS controls Screen Recording and Accessibility
          permissions.
        </p>
      </div>
      {!desktop ? (
        <p className="px-4 py-3 text-xs leading-5 text-muted-foreground">
          Open RIFT Desktop with the same account to connect this Mac. Public
          web reading already works from the browser; localhost and computer
          control need the desktop connection.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {[
            {
              key: "local_web" as const,
              title: "Local websites",
              description:
                "Read localhost pages on this Mac without sharing a folder.",
              enabled: status?.localWeb ?? false,
              Icon: Globe2,
              available: !!status,
            },
            {
              key: "computer" as const,
              title: "Computer control",
              description:
                "Let your agent view the main display and use the mouse and keyboard. Screenshots are sent to your selected model.",
              enabled: status?.computer ?? false,
              Icon: Monitor,
              available: !!status?.supported,
            },
          ].map(({ key, title, description, enabled, Icon, available }) => (
            <div key={key} className="flex items-start gap-3 px-4 py-3">
              <Icon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.7}
              />
              <div className="min-w-0 flex-1">
                <h4 className="font-medium">{title}</h4>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {description}
                </p>
                {key === "computer" && enabled && (
                  <p
                    className="mt-2 text-xs leading-5 text-muted-foreground"
                    role="status"
                  >
                    {status?.screenRecording && status?.accessibility
                      ? "Screen Recording and Accessibility are ready."
                      : `In macOS System Settings → Privacy & Security, enable ${!status?.screenRecording ? "Screen Recording" : ""}${!status?.screenRecording && !status?.accessibility ? " and " : ""}${!status?.accessibility ? "Accessibility" : ""} for RIFT. Reopen RIFT if macOS asks, then return here.`}
                  </p>
                )}
              </div>
              <span
                className="shrink-0 text-xs text-muted-foreground"
                role="status"
              >
                {!available
                  ? "Unavailable"
                  : !enabled
                    ? "Connecting…"
                    : key === "computer" &&
                        (!status?.screenRecording || !status?.accessibility)
                      ? "macOS permission needed"
                      : "Ready"}
              </span>
            </div>
          ))}
        </div>
      )}
      {desktop && status?.supported && status.computer && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {(["screen_recording", "accessibility"] as const)
            .filter((permission) =>
              permission === "screen_recording"
                ? !status.screenRecording
                : !status.accessibility,
            )
            .map((permission) => (
              <button
                key={permission}
                disabled={!!busy}
                type="button"
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                onClick={() => void openPermission(permission)}
              >
                {busy === permission && (
                  <LoaderCircle
                    aria-hidden
                    className="mr-1 inline size-3 animate-spin"
                  />
                )}
                {permission === "screen_recording"
                  ? "Open Screen Recording"
                  : "Open Accessibility"}
              </button>
            ))}
        </div>
      )}
      {error && (
        <p
          className="px-4 pb-3 text-xs leading-5 text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
}
