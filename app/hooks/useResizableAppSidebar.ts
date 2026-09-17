"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export const APP_SIDEBAR_MIN_WIDTH = 220;
export const APP_SIDEBAR_MAX_WIDTH = 420;
/** Room for readable titles and timestamps, with a user-resizable edge. */
export const APP_SIDEBAR_DEFAULT_WIDTH = 248;
export const APP_SIDEBAR_STORAGE_KEY = "rift:app:sidebar-width";

const KEYBOARD_STEP = 8;
const LARGE_KEYBOARD_STEP = 32;
const widthListeners = new Set<() => void>();

function clampWidth(value: number): number {
  return Math.min(
    APP_SIDEBAR_MAX_WIDTH,
    Math.max(APP_SIDEBAR_MIN_WIDTH, Math.round(value)),
  );
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return APP_SIDEBAR_DEFAULT_WIDTH;

  try {
    const stored = Number(window.localStorage.getItem(APP_SIDEBAR_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampWidth(stored)
      : APP_SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return APP_SIDEBAR_DEFAULT_WIDTH;
  }
}

function getServerWidth(): number {
  return APP_SIDEBAR_DEFAULT_WIDTH;
}

function notifyWidthListeners(): void {
  for (const listener of widthListeners) listener();
}

function handleStorage(event: StorageEvent): void {
  if (event.key === APP_SIDEBAR_STORAGE_KEY) notifyWidthListeners();
}

function subscribeToStoredWidth(listener: () => void): () => void {
  widthListeners.add(listener);
  if (widthListeners.size === 1) {
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    widthListeners.delete(listener);
    if (widthListeners.size === 0) {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

function writeStoredWidth(value: number): void {
  const nextWidth = clampWidth(value);
  try {
    window.localStorage.setItem(APP_SIDEBAR_STORAGE_KEY, String(nextWidth));
  } catch {
    // Resizing remains available for this pointer session when storage is blocked.
  }
  notifyWidthListeners();
}

/**
 * Shared desktop-only width controller for the standard and Pro app shells.
 * The caller owns responsive rendering; pass `false` until a desktop viewport
 * is resolved so the mobile drawer never participates in resize behavior.
 */
export function useResizableAppSidebar(enabled: boolean) {
  const storedWidth = useSyncExternalStore(
    subscribeToStoredWidth,
    readStoredWidth,
    getServerWidth,
  );
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const dragging = useRef(false);
  const dragOriginLeft = useRef(0);
  const pendingWidth = useRef<number | null>(null);
  const dragFrame = useRef<number | null>(null);
  const previousDocumentStyles = useRef<{
    cursor: string;
    userSelect: string;
  } | null>(null);
  const width = dragWidth ?? storedWidth;

  const restoreDocumentStyles = useCallback(() => {
    const previous = previousDocumentStyles.current;
    if (!previous) return;
    document.documentElement.style.cursor = previous.cursor;
    document.documentElement.style.userSelect = previous.userSelect;
    previousDocumentStyles.current = null;
  }, []);

  const finishDrag = useCallback(() => {
    if (!dragging.current && pendingWidth.current === null) return;
    dragging.current = false;
    setIsResizing(false);

    if (dragFrame.current !== null) {
      window.cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
    }

    const nextWidth = pendingWidth.current;
    pendingWidth.current = null;
    if (nextWidth !== null) writeStoredWidth(nextWidth);
    setDragWidth(null);
    restoreDocumentStyles();
  }, [restoreDocumentStyles]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled || (event.button !== undefined && event.button !== 0))
        return;

      const sidebar = event.currentTarget.parentElement;
      if (!sidebar) return;

      event.preventDefault();
      dragging.current = true;
      pendingWidth.current = null;
      dragOriginLeft.current = sidebar.getBoundingClientRect().left;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);

      previousDocumentStyles.current = {
        cursor: document.documentElement.style.cursor,
        userSelect: document.documentElement.style.userSelect,
      };
      document.documentElement.style.cursor = "col-resize";
      document.documentElement.style.userSelect = "none";
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;

      pendingWidth.current = clampWidth(event.clientX - dragOriginLeft.current);
      if (dragFrame.current !== null) return;

      dragFrame.current = window.requestAnimationFrame(() => {
        dragFrame.current = null;
        if (!dragging.current || pendingWidth.current === null) return;
        setDragWidth(pendingWidth.current);
      });
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      finishDrag();
    },
    [finishDrag],
  );

  const onDoubleClick = useCallback(() => {
    if (!enabled) return;
    dragging.current = false;
    pendingWidth.current = null;
    if (dragFrame.current !== null) {
      window.cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
    }
    setIsResizing(false);
    setDragWidth(null);
    restoreDocumentStyles();
    writeStoredWidth(APP_SIDEBAR_DEFAULT_WIDTH);
  }, [enabled, restoreDocumentStyles]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const step = event.shiftKey ? LARGE_KEYBOARD_STEP : KEYBOARD_STEP;
      let nextWidth: number;

      switch (event.key) {
        case "ArrowLeft":
          nextWidth = width - step;
          break;
        case "ArrowRight":
          nextWidth = width + step;
          break;
        case "Home":
          nextWidth = APP_SIDEBAR_MIN_WIDTH;
          break;
        case "End":
          nextWidth = APP_SIDEBAR_MAX_WIDTH;
          break;
        default:
          return;
      }

      event.preventDefault();
      setDragWidth(null);
      writeStoredWidth(nextWidth);
    },
    [enabled, width],
  );

  useEffect(() => {
    if (!enabled) return;

    const handlePointerEnd = () => finishDrag();
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("blur", handlePointerEnd);
    return () => {
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("blur", handlePointerEnd);
      finishDrag();
    };
  }, [enabled, finishDrag]);

  useEffect(
    () => () => {
      if (dragFrame.current !== null) {
        window.cancelAnimationFrame(dragFrame.current);
      }
      restoreDocumentStyles();
    },
    [restoreDocumentStyles],
  );

  return {
    width,
    isResizing,
    handleProps: {
      tabIndex: enabled ? 0 : -1,
      "aria-disabled": !enabled,
      "aria-valuemin": APP_SIDEBAR_MIN_WIDTH,
      "aria-valuemax": APP_SIDEBAR_MAX_WIDTH,
      "aria-valuenow": width,
      "aria-valuetext": `${width} pixels wide`,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onLostPointerCapture: finishDrag,
      onDoubleClick,
      onKeyDown,
    },
  };
}
