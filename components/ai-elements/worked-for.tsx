"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { STICKY_BOTTOM_ESCAPE_EVENT } from "@/lib/utils/scroll-events";
import { cn } from "@/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentProps, ReactNode } from "react";

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "1s";
  if (ms < 60_000) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return `${seconds}s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

type WorkedForContextValue = {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  captureScrollPosition: (target: EventTarget | null) => void;
  hasWork: boolean;
};

const WorkedForContext = createContext<WorkedForContextValue | null>(null);

export const useWorkedFor = () => {
  const context = useContext(WorkedForContext);
  if (!context) {
    throw new Error("WorkedFor components must be used within WorkedFor");
  }
  return context;
};

export type WorkedForProps = ComponentProps<typeof Collapsible> & {
  hasWork: boolean;
  isTiming?: boolean;
};

type ScrollSnapshot = {
  element: HTMLElement;
  scrollLeft: number;
  scrollTop: number;
  wasAtBottom: boolean;
};

const getScrollableAncestor = (element: HTMLElement): HTMLElement | null => {
  let parent = element.parentElement;

  while (parent) {
    const { overflowY } = window.getComputedStyle(parent);
    const canScroll =
      (overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay") &&
      parent.scrollHeight > parent.clientHeight;

    if (canScroll) return parent;
    parent = parent.parentElement;
  }

  const scrollingElement = document.scrollingElement;
  return scrollingElement instanceof HTMLElement ? scrollingElement : null;
};

const now = () => Date.now();
const SCROLL_RESTORE_MS = 450;
const BOTTOM_SCROLL_RESTORE_MS = 1_100;
// Mobile browser chrome and smooth resize timing can make "at bottom" read
// slightly off even when the user is visually anchored at the bottom.
const BOTTOM_SCROLL_THRESHOLD_PX = 96;

const escapeStickyBottom = (snapshot: ScrollSnapshot) => {
  if (!snapshot.wasAtBottom) return;

  window.dispatchEvent(new CustomEvent(STICKY_BOTTOM_ESCAPE_EVENT));

  snapshot.element.dispatchEvent(
    new CustomEvent(STICKY_BOTTOM_ESCAPE_EVENT, { bubbles: true }),
  );
};

export function WorkedFor({
  className,
  hasWork,
  isTiming = false,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: WorkedForProps) {
  const [isOpen, setIsOpen] = useControllableState({
    prop: open,
    defaultProp: defaultOpen,
    onChange: onOpenChange,
  });
  const scrollSnapshotRef = useRef<ScrollSnapshot | null>(null);
  const restoreTokenRef = useRef(0);
  const autoCollapseTimeoutRef = useRef<number | null>(null);

  const clearAutoCollapseTimeout = useCallback(() => {
    if (autoCollapseTimeoutRef.current === null) return;

    window.clearTimeout(autoCollapseTimeoutRef.current);
    autoCollapseTimeoutRef.current = null;
  }, []);

  const captureScrollPosition = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return;

    const scrollElement = getScrollableAncestor(target);
    if (!scrollElement) return;
    if (scrollSnapshotRef.current?.element === scrollElement) return;

    scrollSnapshotRef.current = {
      element: scrollElement,
      scrollLeft: scrollElement.scrollLeft,
      scrollTop: scrollElement.scrollTop,
      wasAtBottom:
        scrollElement.scrollHeight -
          scrollElement.scrollTop -
          scrollElement.clientHeight <=
        BOTTOM_SCROLL_THRESHOLD_PX,
    };
  }, []);

  const restoreCapturedScrollPosition = useCallback(() => {
    const snapshot = scrollSnapshotRef.current;
    if (!snapshot) return;

    const token = restoreTokenRef.current + 1;
    restoreTokenRef.current = token;
    const start = now();
    const restoreForMs = snapshot.wasAtBottom
      ? BOTTOM_SCROLL_RESTORE_MS
      : SCROLL_RESTORE_MS;
    const cancelRestore = () => {
      restoreTokenRef.current += 1;
      scrollSnapshotRef.current = null;
      snapshot.element.removeEventListener("wheel", cancelRestore);
      snapshot.element.removeEventListener("touchstart", cancelRestore);
      window.removeEventListener("keydown", cancelRestore);
    };

    snapshot.element.addEventListener("wheel", cancelRestore, { once: true });
    snapshot.element.addEventListener("touchstart", cancelRestore, {
      once: true,
    });
    window.addEventListener("keydown", cancelRestore, { once: true });

    const restore = () => {
      if (restoreTokenRef.current !== token) return;

      snapshot.element.scrollTop = snapshot.scrollTop;
      snapshot.element.scrollLeft = snapshot.scrollLeft;

      if (now() - start < restoreForMs) {
        requestAnimationFrame(restore);
        return;
      }

      snapshot.element.removeEventListener("wheel", cancelRestore);
      snapshot.element.removeEventListener("touchstart", cancelRestore);
      window.removeEventListener("keydown", cancelRestore);
      scrollSnapshotRef.current = null;
    };

    requestAnimationFrame(restore);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      const snapshot = scrollSnapshotRef.current;
      clearAutoCollapseTimeout();
      if (nextOpen && snapshot) {
        escapeStickyBottom(snapshot);
      }
      setIsOpen(nextOpen);
      restoreCapturedScrollPosition();
    },
    [clearAutoCollapseTimeout, restoreCapturedScrollPosition, setIsOpen],
  );

  useEffect(() => {
    // Keep the transcript open while working and after the run finishes.
    // after the run finishes. Previously a 700ms timer collapsed the whole
    // WorkedFor when timing stopped, so every reasoning + terminal step appeared
    // to vanish the instant the final answer arrived. Now the steps stay as a
    // persistent record (Hermes-style); the user can collapse them by hand.
    if (isTiming) {
      clearAutoCollapseTimeout();
      setIsOpen(true);
    }
  }, [clearAutoCollapseTimeout, isTiming, setIsOpen]);

  useEffect(() => clearAutoCollapseTimeout, [clearAutoCollapseTimeout]);

  const contextValue = useMemo(
    () => ({
      isOpen: !!isOpen,
      setIsOpen: handleOpenChange,
      captureScrollPosition,
      hasWork,
    }),
    [isOpen, handleOpenChange, captureScrollPosition, hasWork],
  );

  return (
    <WorkedForContext.Provider value={contextValue}>
      <Collapsible
        data-ui="work-log"
        data-timing={isTiming ? "true" : "false"}
        open={hasWork ? !!isOpen : false}
        onOpenChange={hasWork ? handleOpenChange : undefined}
        className={cn("not-prose w-full space-y-0", className)}
        {...props}
      >
        {children}
      </Collapsible>
    </WorkedForContext.Provider>
  );
}

export type WorkedForTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  durationMs?: number;
  startedAt?: number;
  label?: ReactNode;
  isTiming?: boolean;
  /** Right-aligned run figures (tokens, cost), the way a TUI closes a run. */
  trailing?: ReactNode;
};

export function WorkedForTrigger({
  className,
  durationMs,
  startedAt,
  isTiming = false,
  label,
  trailing,
  onClick,
  onKeyDown,
  onPointerDown,
  onTouchStart,
  ...props
}: WorkedForTriggerProps) {
  const { isOpen, hasWork, captureScrollPosition } = useWorkedFor();
  const timingStartedAtRef = useRef<number | null>(null);
  const getElapsedMs = useCallback(() => {
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) {
      return 0;
    }

    return Math.max(0, Date.now() - startedAt);
  }, [startedAt]);
  const [elapsedMs, setElapsedMs] = useState(() => getElapsedMs());
  useEffect(() => {
    if (!isTiming) {
      timingStartedAtRef.current = null;
      return;
    }

    timingStartedAtRef.current =
      typeof startedAt === "number" && Number.isFinite(startedAt)
        ? startedAt
        : (timingStartedAtRef.current ?? Date.now());

    const updateElapsed = () => {
      setElapsedMs(
        Math.max(0, Date.now() - (timingStartedAtRef.current ?? Date.now())),
      );
    };

    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [isTiming, startedAt]);

  const text =
    label ??
    (isTiming
      ? `Running for ${formatDuration(elapsedMs)}`
      : typeof durationMs === "number" && durationMs > 0
        ? `Worked for ${formatDuration(durationMs)}`
        : "Worked");
  const canToggle = hasWork && !isTiming;
  const handlePointerDown: WorkedForTriggerProps["onPointerDown"] = (event) => {
    onPointerDown?.(event);
    if (!event.defaultPrevented && canToggle) {
      captureScrollPosition(event.currentTarget);
    }
  };
  const handleTouchStart: WorkedForTriggerProps["onTouchStart"] = (event) => {
    onTouchStart?.(event);
    if (!event.defaultPrevented && canToggle) {
      captureScrollPosition(event.currentTarget);
    }
  };
  const handleKeyDown: WorkedForTriggerProps["onKeyDown"] = (event) => {
    onKeyDown?.(event);
    if (
      !event.defaultPrevented &&
      canToggle &&
      (event.key === "Enter" || event.key === " ")
    ) {
      captureScrollPosition(event.currentTarget);
    }
  };
  const handleClick: WorkedForTriggerProps["onClick"] = (event) => {
    onClick?.(event);
    if (!event.defaultPrevented && canToggle) {
      captureScrollPosition(event.currentTarget);
    }
  };

  return (
    <CollapsibleTrigger
      data-ui="work-summary"
      data-running={isTiming ? "true" : "false"}
      disabled={!canToggle}
      className={cn(
        "group/work flex min-h-6 w-full items-center gap-1 py-0.5 text-left text-[12px] leading-5 text-muted-foreground transition-colors focus-visible:outline-none",
        canToggle && "hover:text-foreground",
        !canToggle && "cursor-default",
        className,
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onTouchStart={handleTouchStart}
      {...props}
    >
      <span className="min-w-0 truncate font-normal text-[var(--cursor-text-secondary)] group-hover/work:text-foreground">
        {text}
      </span>
      {trailing ? (
        <span
          data-ui="work-summary-figures"
          className="ml-auto shrink-0 pl-3 font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {trailing}
        </span>
      ) : null}
      {canToggle ? (
        <ChevronRightIcon
          data-ui="work-summary-chevron"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/50",
            isOpen && "rotate-90",
          )}
          aria-hidden="true"
        />
      ) : null}
    </CollapsibleTrigger>
  );
}

export type WorkedForContentProps = Omit<
  ComponentProps<typeof CollapsibleContent>,
  "children"
> & {
  children: ReactNode | (() => ReactNode);
  lazy?: boolean;
};

export function WorkedForContent({
  className,
  children,
  lazy = false,
  ...props
}: WorkedForContentProps) {
  const { isOpen } = useWorkedFor();
  const shouldRenderChildren = !lazy || isOpen;

  return (
    <CollapsibleContent
      data-ui="work-transcript"
      className={cn("worked-for-content mt-0 space-y-0", className)}
      {...props}
    >
      {shouldRenderChildren
        ? typeof children === "function"
          ? children()
          : children
        : null}
    </CollapsibleContent>
  );
}

WorkedFor.displayName = "WorkedFor";
WorkedForTrigger.displayName = "WorkedForTrigger";
WorkedForContent.displayName = "WorkedForContent";
