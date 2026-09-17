"use client";
import { useSyncExternalStore } from "react";
import { parseApprovalMode, type ApprovalMode } from "@/lib/ai/approval/policy";
const KEY = "rift:approval-mode";
const EVENT = "rift:approval-mode-changed";
export function readApprovalMode(): ApprovalMode {
  try {
    const stored = window.localStorage.getItem(KEY);
    // Default to fully-autonomous ("Run freely") so the agent never stops for a
    // per-command approval unless the owner explicitly picks a stricter mode.
    if (stored === null) return "full";
    return parseApprovalMode(stored);
  } catch {
    return "full";
  }
}
function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
export function useApprovalMode() {
  const mode = useSyncExternalStore(
    subscribe,
    readApprovalMode,
    () => "full" as const,
  );
  return [
    mode,
    (value: ApprovalMode) => {
      try {
        localStorage.setItem(KEY, value);
        window.dispatchEvent(new Event(EVENT));
      } catch {
        /* Keep the stricter default if preferences cannot be saved. */
      }
    },
  ] as const;
}
