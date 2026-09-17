"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const MIN_PANE = 280;
const MIN_CHAT = 400;
const MAX_RATIO = 0.72;
const DEFAULT_RATIO = 0.42;
const MIN_STORED_RATIO = MIN_PANE / 1200;
const KEYBOARD_STEP = 0.02;
const LARGE_KEYBOARD_STEP = 0.1;
const STORAGE_KEY = "rift:pro:split-ratio";
const ratioListeners = new Set<() => void>();
let cachedRatio: number | undefined;

function readStoredRatio(): number {
  if (cachedRatio !== undefined) return cachedRatio;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cachedRatio = DEFAULT_RATIO;
      return cachedRatio;
    }
    const n = Number(raw);
    cachedRatio = Number.isFinite(n)
      ? Math.min(MAX_RATIO, Math.max(MIN_STORED_RATIO, n))
      : DEFAULT_RATIO;
    return cachedRatio;
  } catch {
    return DEFAULT_RATIO;
  }
}

function notifyRatioListeners() {
  for (const listener of ratioListeners) listener();
}

function handleStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY) return;
  cachedRatio = undefined;
  notifyRatioListeners();
}

function subscribeToStoredRatio(listener: () => void) {
  ratioListeners.add(listener);
  if (ratioListeners.size === 1) {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    ratioListeners.delete(listener);
    if (ratioListeners.size === 0) {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

function writeStoredRatio(value: number) {
  const nextRatio = Math.min(MAX_RATIO, Math.max(MIN_STORED_RATIO, value));
  cachedRatio = nextRatio;
  try {
    localStorage.setItem(STORAGE_KEY, String(nextRatio));
  } catch {
    // In-memory state still keeps resizing functional when storage is blocked.
  }
  notifyRatioListeners();
}

function getRatioBounds(containerWidth?: number) {
  if (!containerWidth || containerWidth <= 0) {
    return { min: MIN_STORED_RATIO, max: MAX_RATIO };
  }
  // Below the combined minimum, share the available space proportionally.
  if (containerWidth < MIN_PANE + MIN_CHAT) {
    const ratio = MIN_PANE / (MIN_PANE + MIN_CHAT);
    return { min: ratio, max: ratio };
  }
  return {
    min: Math.max(MIN_STORED_RATIO, MIN_PANE / containerWidth),
    max: Math.min(MAX_RATIO, 1 - MIN_CHAT / containerWidth),
  };
}

function clampRatio(ratio: number, containerWidth?: number) {
  const { min, max } = getRatioBounds(containerWidth);
  return Math.min(max, Math.max(min, ratio));
}

function getPaneForHandle(handle: HTMLElement): HTMLElement | null {
  const pane = handle.nextElementSibling;
  return pane instanceof HTMLElement ? pane : null;
}

function applyLiveRatio(
  handle: HTMLElement | null,
  pane: HTMLElement | null,
  ratio: number,
) {
  const percentage = Math.round(ratio * 10_000) / 100;
  if (pane) pane.style.width = `${percentage}%`;
  if (handle) {
    handle.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    handle.setAttribute(
      "aria-valuetext",
      `${Math.round(ratio * 100)}% panel width`,
    );
  }
}

function applyAriaBounds(handle: HTMLElement, containerWidth?: number) {
  const { min, max } = getRatioBounds(containerWidth);
  handle.setAttribute("aria-valuemin", String(Math.round(min * 100)));
  handle.setAttribute("aria-valuemax", String(Math.round(max * 100)));
}

export function useResizableSplit(open: boolean) {
  const storedRatio = useSyncExternalStore(
    subscribeToStoredRatio,
    readStoredRatio,
    () => DEFAULT_RATIO,
  );
  const [isResizing, setIsResizing] = useState(false);
  const dragging = useRef(false);
  const pendingRatio = useRef<number | null>(null);
  const dragFrame = useRef<number | null>(null);
  const dragRect = useRef<{ right: number; width: number } | null>(null);
  const dragHandle = useRef<HTMLElement | null>(null);
  const dragPane = useRef<HTMLElement | null>(null);
  const previousDocumentState = useRef<{
    cursor: string;
    userSelect: string;
    resizeAttribute: string | null;
  } | null>(null);
  const [handle, setHandle] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>();
  const bounds = getRatioBounds(containerWidth);
  const ratio = clampRatio(storedRatio, containerWidth);

  useLayoutEffect(() => {
    const root = handle?.parentElement;
    if (!open || !root) return;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      setContainerWidth(rect.width);
      if (dragging.current) {
        dragRect.current = { right: rect.right, width: rect.width };
        if (pendingRatio.current !== null) {
          pendingRatio.current = clampRatio(pendingRatio.current, rect.width);
          applyLiveRatio(handle, dragPane.current, pendingRatio.current);
        }
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [handle, open]);

  const restoreDocumentState = useCallback(() => {
    const previous = previousDocumentState.current;
    if (!previous) return;

    document.documentElement.style.cursor = previous.cursor;
    document.documentElement.style.userSelect = previous.userSelect;
    if (previous.resizeAttribute === null) {
      delete document.documentElement.dataset.riftPanelResizing;
    } else {
      document.documentElement.dataset.riftPanelResizing =
        previous.resizeAttribute;
    }
    previousDocumentState.current = null;
  }, []);

  const finishDrag = useCallback(() => {
    if (!dragging.current && pendingRatio.current === null) return;
    dragging.current = false;
    setIsResizing(false);
    if (dragFrame.current !== null) {
      window.cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
    }
    const next = pendingRatio.current;
    pendingRatio.current = null;
    if (next !== null) writeStoredRatio(next);
    dragRect.current = null;
    dragHandle.current = null;
    dragPane.current = null;
    restoreDocumentState();
  }, [restoreDocumentState]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        !open ||
        (event.button !== undefined && event.button !== 0) ||
        event.isPrimary === false
      ) {
        return;
      }

      const root = event.currentTarget.parentElement;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0) return;

      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      dragging.current = true;
      pendingRatio.current = null;
      dragRect.current = { right: rect.right, width: rect.width };
      dragHandle.current = event.currentTarget;
      dragPane.current = getPaneForHandle(event.currentTarget);
      applyAriaBounds(event.currentTarget, rect.width);
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);

      previousDocumentState.current = {
        cursor: document.documentElement.style.cursor,
        userSelect: document.documentElement.style.userSelect,
        resizeAttribute:
          document.documentElement.dataset.riftPanelResizing ?? null,
      };
      document.documentElement.style.cursor = "col-resize";
      document.documentElement.style.userSelect = "none";
      document.documentElement.dataset.riftPanelResizing = "true";
    },
    [open],
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!dragging.current) return;
    const rect = dragRect.current;
    if (!rect) return;
    const fromRight = rect.right - event.clientX;
    const next = clampRatio(fromRight / rect.width, rect.width);
    pendingRatio.current = next;
    if (dragFrame.current !== null) return;
    dragFrame.current = window.requestAnimationFrame(() => {
      dragFrame.current = null;
      if (!dragging.current || pendingRatio.current === null) return;
      applyLiveRatio(
        dragHandle.current,
        dragPane.current,
        pendingRatio.current,
      );
    });
  }, []);

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
    dragging.current = false;
    pendingRatio.current = null;
    if (dragFrame.current !== null) {
      window.cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
    }
    setIsResizing(false);
    applyLiveRatio(
      dragHandle.current,
      dragPane.current,
      clampRatio(DEFAULT_RATIO, containerWidth),
    );
    dragRect.current = null;
    dragHandle.current = null;
    dragPane.current = null;
    restoreDocumentState();
    writeStoredRatio(DEFAULT_RATIO);
  }, [containerWidth, restoreDocumentState]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!open) return;
      const containerWidth =
        event.currentTarget.parentElement?.getBoundingClientRect().width;
      const { min, max } = getRatioBounds(containerWidth);
      const currentRatio = clampRatio(ratio, containerWidth);
      const step = event.shiftKey ? LARGE_KEYBOARD_STEP : KEYBOARD_STEP;
      let nextRatio: number;

      switch (event.key) {
        // The ratio describes the right pane, so moving the separator left
        // increases its width and moving it right decreases its width.
        case "ArrowLeft":
          nextRatio = currentRatio + step;
          break;
        case "ArrowRight":
          nextRatio = currentRatio - step;
          break;
        case "Home":
          nextRatio = min;
          break;
        case "End":
          nextRatio = max;
          break;
        default:
          return;
      }

      event.preventDefault();
      writeStoredRatio(clampRatio(nextRatio, containerWidth));
    },
    [open, ratio],
  );

  const onFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const containerWidth =
      event.currentTarget.parentElement?.getBoundingClientRect().width;
    applyAriaBounds(event.currentTarget, containerWidth);
  }, []);

  useEffect(
    () => () => {
      if (dragFrame.current !== null) {
        window.cancelAnimationFrame(dragFrame.current);
      }
      restoreDocumentState();
    },
    [restoreDocumentState],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerEnd = () => finishDrag();
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("blur", onPointerEnd);
    return () => {
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", onPointerEnd);
      finishDrag();
    };
  }, [finishDrag, open]);

  return {
    ratio,
    isResizing,
    handleProps: {
      ref: setHandle,
      tabIndex: open ? 0 : -1,
      "aria-disabled": !open,
      "aria-valuemin": Math.round(bounds.min * 100),
      "aria-valuemax": Math.round(bounds.max * 100),
      "aria-valuenow": Math.round(ratio * 100),
      "aria-valuetext": `${Math.round(ratio * 100)}% panel width`,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: finishDrag,
      onLostPointerCapture: finishDrag,
      onDoubleClick,
      onKeyDown,
      onFocus,
    },
  };
}
