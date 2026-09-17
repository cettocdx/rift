import { useMemo, useSyncExternalStore } from "react";
import {
  parseWorkingFileContext,
  type WorkingFileContext,
} from "@/lib/desktop/working-file-context";

const PREFIX = "rift:working-file:";
const CHANGED = "rift:working-file-changed";
// Native grants live only for the desktop session. No file contents or host
// paths are persisted, and a new chat never inherits another chat's selection.
const fallback = new Map<string, string>();

function readRaw(chatId?: string): string | null {
  if (!chatId || typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(PREFIX + chatId);
  } catch {
    return fallback.get(chatId) ?? null;
  }
}

function parseRaw(raw: string | null): WorkingFileContext | undefined {
  if (!raw) return undefined;
  try {
    return parseWorkingFileContext(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function readWorkingFileRequestContext(chatId?: string) {
  return parseRaw(readRaw(chatId));
}

export function setWorkingFile(
  chatId: string,
  file: WorkingFileContext | null,
) {
  const parsed = file ? parseWorkingFileContext(file) : undefined;
  if (!chatId || typeof window === "undefined") return;
  const value = parsed ? JSON.stringify(parsed) : null;
  if (value) fallback.set(chatId, value);
  else fallback.delete(chatId);
  try {
    if (value) window.sessionStorage.setItem(PREFIX + chatId, value);
    else window.sessionStorage.removeItem(PREFIX + chatId);
  } catch {
    // The current desktop session can still work when storage is disabled.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGED, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGED, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useWorkingFile(chatId?: string) {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(chatId),
    () => null,
  );
  return useMemo(() => parseRaw(raw), [raw]);
}
