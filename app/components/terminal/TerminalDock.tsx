"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useGlobalState } from "@/app/contexts/GlobalState";
import { WorkbenchTerminalPanel } from "@/app/components/workbench/WorkbenchTerminalPanel";
import { SandboxWorkbenchProvider } from "@/app/components/workbench/WorkbenchProvider";
import { WorkbenchActivityProvider } from "@/app/components/workbench/WorkbenchActivity";
import { hideWorkbench, maximizeWorkbench } from "@/lib/workbench/events";
import styles from "./TerminalDock.module.css";

const MIN_WIDTH = 320;
const MAX_DEFAULT_WIDTH = 560;
const MOBILE_BREAKPOINT = 768;
const WIDTH_STORAGE_KEY = "rift:terminal-dock:width:v1";
const HOST_SELECTOR = "[data-rift-terminal-host]";

interface TerminalHostFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  active: boolean;
  maximized: boolean;
  embedded: boolean;
}

/** Follow the slot without moving the React tree, which would recreate PTYs. */
function useTerminalHostFrame(enabled: boolean) {
  const [frame, setFrame] = useState<TerminalHostFrame | null>(null);
  useLayoutEffect(() => {
    // Keep the session mounted while hidden, without observing every chat delta.
    // Reopening measures the current host before paint.
    if (!enabled) return;
    let host: HTMLElement | null = null;
    let main: HTMLElement | null = null;
    let titlebar: HTMLElement | null = null;
    let pendingFrame = 0;
    const resizeObserver = new ResizeObserver(() => schedule());
    const measure = () => {
      pendingFrame = 0;
      const nextHost = document.querySelector<HTMLElement>(HOST_SELECTOR);
      const nextMain = document.querySelector<HTMLElement>(
        "[data-rift-main-panel]",
      );
      const nextTitlebar = document.querySelector<HTMLElement>(
        window.innerWidth < MOBILE_BREAKPOINT
          ? "[data-pro-mobile-app-bar]"
          : '[data-rift-native-titlebar="window"]',
      );
      if (nextHost !== host || nextMain !== main || nextTitlebar !== titlebar) {
        resizeObserver.disconnect();
        host = nextHost;
        main = nextMain;
        titlebar = nextTitlebar;
        // Ancestor resizes can move a slot without resizing the slot itself.
        for (
          let element = host ?? main;
          element;
          element = element.parentElement
        )
          resizeObserver.observe(element);
        if (titlebar) resizeObserver.observe(titlebar);
      }
      const mainRect = main?.getBoundingClientRect();
      const titlebarRect = titlebar?.getBoundingClientRect();
      const fallbackLeft = mainRect && mainRect.width > 0 ? mainRect.left : 0;
      const fallbackRight =
        mainRect && mainRect.width > 0 ? mainRect.right : window.innerWidth;
      const fallbackTop = Math.max(
        mainRect && mainRect.height > 0 ? mainRect.top : 0,
        titlebarRect && titlebarRect.height > 0 ? titlebarRect.bottom : 0,
      );
      const fallbackBottom =
        mainRect && mainRect.height > 0 ? mainRect.bottom : window.innerHeight;
      const rect = host?.getBoundingClientRect();
      const next =
        rect && host
          ? {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              active:
                host.dataset.active === "true" &&
                rect.width > 0 &&
                rect.height > 0,
              maximized: host.dataset.maximized === "true",
              embedded: true,
            }
          : {
              left: fallbackLeft,
              top: fallbackTop,
              width: Math.max(0, fallbackRight - fallbackLeft),
              height: Math.max(0, fallbackBottom - fallbackTop),
              active: true,
              maximized: false,
              embedded: false,
            };
      setFrame((previous) =>
        previous &&
        previous.left === next.left &&
        previous.top === next.top &&
        previous.width === next.width &&
        previous.height === next.height &&
        previous.active === next.active &&
        previous.maximized === next.maximized &&
        previous.embedded === next.embedded
          ? previous
          : next,
      );
    };
    function schedule() {
      if (!pendingFrame) pendingFrame = requestAnimationFrame(measure);
    }
    const mutationObserver = new MutationObserver((records) => {
      if (
        !host ||
        !host.isConnected ||
        records.some((record) => {
          if (record.target === host || record.target.contains(host))
            return true;
          return Array.from(record.addedNodes).some(
            (node) =>
              node instanceof Element &&
              (node.matches(HOST_SELECTOR) ||
                node.querySelector(HOST_SELECTOR)),
          );
        })
      )
        schedule();
    });
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "data-active",
        "data-maximized",
        "hidden",
        "class",
        "style",
      ],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    measure();
    return () => {
      cancelAnimationFrame(pendingFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [enabled]);
  return frame;
}

export function TerminalDock() {
  const {
    terminalDockOpen,
    setTerminalDockOpen,
    terminalDockView,
    setTerminalDockView,
  } = useGlobalState();
  const hostFrame = useTerminalHostFrame(terminalDockOpen);
  const embedded = hostFrame?.embedded === true;
  const visible = terminalDockOpen && (!embedded || hostFrame.active);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
      return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : null;
    } catch {
      return null;
    }
  });
  const [maximized, setMaximized] = useState(false);
  const availableWidth =
    hostFrame?.width ??
    (typeof window === "undefined" ? 1200 : window.innerWidth);
  const smallViewport =
    typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;
  const minimumWidth = Math.min(MIN_WIDTH, availableWidth);
  const maximumWidth = Math.min(
    availableWidth,
    Math.max(MIN_WIDTH, availableWidth * 0.72),
  );
  const defaultWidth = Math.min(
    MAX_DEFAULT_WIDTH,
    Math.max(minimumWidth, availableWidth * 0.45),
  );
  const width =
    smallViewport || maximized
      ? availableWidth
      : Math.max(
          minimumWidth,
          Math.min(maximumWidth, preferredWidth ?? defaultWidth),
        );
  const widthRef = useRef(width);
  useLayoutEffect(() => {
    widthRef.current = width;
  }, [width]);
  const dragStateRef = useRef<{
    startX: number;
    startWidth: number;
    cursor: string;
    userSelect: string;
  } | null>(null);
  const [resizing, setResizing] = useState(false);
  // Keep one React tree throughout host changes, hiding, and resizing. Its PTY
  // and terminal applications belong to the session, never to the dock layout.
  const [hasOpened, setHasOpened] = useState(terminalDockOpen);
  if (terminalDockOpen && !hasOpened) setHasOpened(true);

  const rememberWidth = (value: number) => {
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(value));
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  };

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      // Escape is a meaningful byte in terminal apps and belongs to an open
      // picker/editor first. Never dismiss the pane while interacting with it.
      if (
        target instanceof Element &&
        target.closest(
          '[data-workbench-interactive-terminal], .xterm, input, textarea, select, [contenteditable="true"], [role="combobox"], [role="menu"], [role="listbox"], [role="dialog"], [aria-haspopup]',
        )
      )
        return;
      setTerminalDockOpen(false);
      if (embedded) hideWorkbench();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, embedded, setTerminalDockOpen]);

  useEffect(() => {
    const restoreDocument = () => {
      const drag = dragStateRef.current;
      if (!drag) return;
      document.documentElement.style.cursor = drag.cursor;
      document.documentElement.style.userSelect = drag.userSelect;
      dragStateRef.current = null;
    };
    const onMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const next = Math.max(
        minimumWidth,
        Math.min(maximumWidth, drag.startWidth + drag.startX - event.clientX),
      );
      widthRef.current = next;
      setPreferredWidth(next);
    };
    const onUp = () => {
      if (!dragStateRef.current) return;
      rememberWidth(widthRef.current);
      restoreDocument();
      setResizing(false);
    };
    const onCancel = () => {
      const drag = dragStateRef.current;
      if (!drag) return;
      setPreferredWidth(drag.startWidth);
      restoreDocument();
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onUp);
    return () => {
      restoreDocument();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onUp);
    };
  }, [minimumWidth, maximumWidth]);

  if (!hasOpened) return null;

  return (
    <div
      data-ui="terminal-dock"
      data-workbench-surface="graphite"
      data-state={visible ? "open" : "closed"}
      data-embedded={embedded ? "true" : "false"}
      data-placement="right"
      data-resizing={resizing ? "true" : "false"}
      inert={!visible}
      aria-hidden={!visible}
      className={`${styles.dock} ${embedded ? styles.embedded : styles.floating}`}
      style={
        embedded && hostFrame
          ? {
              top: hostFrame.top,
              left: hostFrame.left,
              width: hostFrame.width,
              height: hostFrame.height,
              visibility: visible ? "visible" : "hidden",
              pointerEvents: visible ? "auto" : "none",
            }
          : {
              top: hostFrame?.top ?? 0,
              left: (hostFrame?.left ?? 0) + availableWidth - width,
              width,
              height: hostFrame?.height ?? "100dvh",
            }
      }
    >
      {!embedded && !smallViewport && !maximized && (
        <div
          key="resize"
          role="separator"
          tabIndex={visible ? 0 : -1}
          aria-orientation="vertical"
          aria-label="Resize terminal"
          aria-valuemin={Math.round(minimumWidth)}
          aria-valuemax={Math.round(maximumWidth)}
          aria-valuenow={Math.round(width)}
          aria-valuetext={`${Math.round(width)} pixels wide`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragStateRef.current = {
              startX: event.clientX,
              startWidth: width,
              cursor: document.documentElement.style.cursor,
              userSelect: document.documentElement.style.userSelect,
            };
            document.documentElement.style.cursor = "col-resize";
            document.documentElement.style.userSelect = "none";
            setResizing(true);
          }}
          onDoubleClick={() => {
            setPreferredWidth(defaultWidth);
            rememberWidth(defaultWidth);
          }}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            event.stopPropagation();
            const next =
              event.key === "Home"
                ? minimumWidth
                : event.key === "End"
                  ? maximumWidth
                  : Math.max(
                      minimumWidth,
                      Math.min(
                        maximumWidth,
                        width + (event.key === "ArrowLeft" ? 20 : -20),
                      ),
                    );
            setPreferredWidth(next);
            rememberWidth(next);
          }}
          className={styles.resizer}
        />
      )}
      <div key="terminal-panel" className="min-h-0 flex-1">
        {/* The panel reads workspace state and activity through context, so it
            needs the same provider pair CursorIdeLayout composes for the
            workspace route. Without them the dock threw on mount and took the
            page down with it. */}
        <WorkbenchActivityProvider>
          <SandboxWorkbenchProvider>
            <WorkbenchTerminalPanel
              compact
              view={terminalDockView}
              onViewChange={setTerminalDockView}
              onRequestClose={() => {
                setTerminalDockOpen(false);
                if (embedded) hideWorkbench();
              }}
              hostFullscreen={
                embedded && hostFrame ? hostFrame.maximized : maximized
              }
              onToggleFullscreen={() => {
                if (embedded) {
                  maximizeWorkbench();
                  return;
                }
                setMaximized((value) => !value);
              }}
            />
          </SandboxWorkbenchProvider>
        </WorkbenchActivityProvider>
      </div>
    </div>
  );
}
