"use client";

import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import type { ChatStatus } from "@/types/chat";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import {
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
  getDesktopAccessStatus,
  setDesktopAccess,
  openDesktopPermissionSettings,
  type DesktopAccessStatus,
} from "@/app/services/desktop-local-access";
import { submitChatMessage } from "@/lib/utils/submit-message";
import {
  summarizeTranscriptTools,
  type TranscriptToolPart,
} from "@/lib/chat/transcript-presentation";

/** Presence does not grant access. Consent stays visible in the conversation. */
export function DesktopAccessStatusHandler({
  part,
  status,
  readOnly = false,
}: {
  part: TranscriptToolPart;
  status: ChatStatus;
  readOnly?: boolean;
}) {
  const summary = summarizeTranscriptTools([part], status);
  const output =
    part.output && typeof part.output === "object"
      ? (part.output as Record<string, unknown>)
      : {};
  const detail =
    typeof part.errorText === "string"
      ? part.errorText
      : typeof output.error === "string"
        ? output.error
        : undefined;
  const [access, setAccess] = useState<DesktopAccessStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dismissed, setDismissed] = useState(false);
  const [sent, setSent] = useState(false);
  const native = isTauriEnvironment();
  const completed = part.state === "output-available";
  const observedAccess =
    output.access && typeof output.access === "object"
      ? (output.access as Record<string, unknown>)
      : {};
  const probeNeedsSetup =
    part.type === "tool-desktop_access_status" &&
    output.ok === true &&
    ["computer", "screenRecording", "accessibility"].some(
      (permission) => observedAccess[permission] === false,
    );
  // A healthy probe is informational. Model limitations and uncertain input
  // outcomes need their own recovery, not another permission/continue prompt.
  const permissionRelevant =
    probeNeedsSetup ||
    (output.ok === false &&
      ["unavailable", "denied", "disconnected", "timeout"].includes(
        String(output.code),
      ));
  useEffect(() => {
    if (!native || readOnly || !completed || !permissionRelevant) return;
    let disposed = false;
    const refresh = () => {
      void getDesktopAccessStatus()
        .then((value) => {
          if (!disposed) setAccess(value);
        })
        .catch(() => {
          /* Keep the last observed state on a transient IPC failure. */
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, refresh);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refresh);
      window.removeEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, refresh);
    };
  }, [native, readOnly, completed, permissionRelevant]);
  const ready =
    access?.computer && access.screenRecording && access.accessibility;
  const action = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await operation();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not update desktop access. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const button =
    "rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted disabled:opacity-50";
  return (
    <div
      data-ui="desktop-access-result"
      data-status={summary.status}
      className="not-prose py-1.5 text-[13px] leading-5 text-muted-foreground"
    >
      <div className="flex items-center gap-2">
        <Monitor
          aria-hidden="true"
          className="size-3.5 shrink-0"
          strokeWidth={1.5}
        />
        <span>{summary.label}</span>
      </div>
      {detail ? <p className="mt-1 pl-[22px] break-words">{detail}</p> : null}
      {summary.status === "needs-setup" && !native ? (
        <p className="mt-1 pl-[22px]">
          Cloud work can continue. Open RIFT Desktop with the same account to
          connect this Mac.
        </p>
      ) : null}
      {native &&
      !readOnly &&
      completed &&
      permissionRelevant &&
      !dismissed &&
      access?.supported ? (
        <section
          aria-label="Desktop permission"
          className="my-2 rounded-xl border border-border bg-background p-4"
        >
          <p className="font-medium text-foreground">
            {ready
              ? "Computer access is ready"
              : access.computer
                ? "macOS permissions needed"
                : "Reconnect RIFT Desktop"}
          </p>
          <p className="mt-1">
            Computer control is available while signed in. Screen contents are
            sent to your selected model only when your task uses the desktop.
          </p>
          {access.computer && !ready ? (
            <p className="mt-2">
              macOS permission is still required. Enable RIFT in the settings
              below, then return here. Reopen RIFT if macOS requests it.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {!access.computer ? (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setAccess(await setDesktopAccess("computer", true)),
                  )
                }
              >
                Allow computer access
              </button>
            ) : null}
            {access.computer && !access.screenRecording ? (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    openDesktopPermissionSettings("screen_recording"),
                  )
                }
              >
                Open Screen Recording
              </button>
            ) : null}
            {access.computer && !access.accessibility ? (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    openDesktopPermissionSettings("accessibility"),
                  )
                }
              >
                Open Accessibility
              </button>
            ) : null}
            {access.computer && !ready ? (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setAccess(await getDesktopAccessStatus()),
                  )
                }
              >
                Check permissions
              </button>
            ) : null}
            {ready ? (
              <button
                className={button}
                disabled={
                  busy ||
                  sent ||
                  status === "streaming" ||
                  status === "submitted"
                }
                onClick={() => {
                  setSent(true);
                  submitChatMessage(
                    "Computer access is enabled for this task. Check desktop access and take a fresh screenshot, then continue from the current state. Do not repeat any previous mouse or keyboard action without inspecting the screen first.",
                  );
                }}
              >
                {sent ? "Sent" : "Continue task"}
              </button>
            ) : null}
            <button
              className={button}
              disabled={busy}
              onClick={() => setDismissed(true)}
            >
              Not now
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-destructive">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
