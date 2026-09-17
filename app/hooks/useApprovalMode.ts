"use client";
import { useSyncExternalStore } from "react";
import { parseApprovalMode, type ApprovalMode } from "@/lib/ai/approval/policy";
const KEY = "rift:approval-mode";
const EVENT = "rift:approval-mode-changed";
export function readApprovalMode(): ApprovalMode {
  try {
    return parseApprovalMode(window.localStorage.getItem(KEY));
  } catch {
    return "ask";
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
    () => "ask" as const,
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
