"use client";

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { observeChatViewport } from "./chat-layout/ChatViewport";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

interface MobileToolDialogProps {
  backgroundRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  contentClassName: string;
  description: string;
  label: string;
  onClose: () => void;
}

/**
 * Accessible full-screen shell for the mobile preview and computer panels.
 * Radix supplies the focus trap and outside-content hiding; the explicit
 * `inert` boundary also prevents the chat surface from receiving interaction.
 */
export function MobileToolDialog({
  backgroundRef,
  children,
  contentClassName,
  description,
  label,
  onClose,
}: MobileToolDialogProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Radix attaches its portal after the parent render. Observe at attachment
  // so a panel opened while the keyboard is already visible gets its bounds.
  const attachContent = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
    if (!node) return;
    const stopObserving = observeChatViewport(node);
    return () => {
      stopObserving();
      if (contentRef.current === node) contentRef.current = null;
    };
  }, []);
  const restoreBackgroundRef = useRef<() => void>(() => undefined);
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      typeof HTMLElement !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  useEffect(() => {
    const background = backgroundRef.current;
    if (!background) return;

    const wasInert = background.inert === true;
    const previousAriaHidden = background.getAttribute("aria-hidden");
    let restored = false;

    background.inert = true;
    background.setAttribute("aria-hidden", "true");

    const restore = () => {
      if (restored) return;
      restored = true;
      background.inert = wasInert;
      if (previousAriaHidden === null) {
        background.removeAttribute("aria-hidden");
      } else {
        background.setAttribute("aria-hidden", previousAriaHidden);
      }
    };

    restoreBackgroundRef.current = restore;
    return restore;
  }, [backgroundRef]);

  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    contentRef.current?.focus();
  }, []);

  const handleCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    restoreBackgroundRef.current();

    const previousFocus = restoreFocusRef.current;
    if (previousFocus?.isConnected)
      previousFocus.focus({ preventScroll: true });
  }, []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={attachContent}
        aria-modal="true"
        style={{
          top: "var(--rift-chat-viewport-offset, 0px)",
          height: "var(--rift-chat-viewport-height, 100dvh)",
        }}
        className={cn(
          contentClassName,
          "fixed left-0 top-0 flex h-dvh w-full max-w-none flex-col items-stretch justify-start translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none sm:max-w-none data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
        )}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        showCloseButton={false}
        tabIndex={-1}
      >
        <div
          data-mobile-tool-header
          className="relative z-10 flex w-full min-w-0 shrink-0 items-center gap-2 border-b border-border bg-background pl-[max(12px,env(safe-area-inset-left))] pr-[max(8px,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]"
        >
          <DialogTitle className="min-w-0 flex-1 truncate">{label}</DialogTitle>
          <button
            type="button"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-ring"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div
          data-mobile-tool-content
          className="relative z-0 w-full min-h-0 min-w-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] [&_[data-build-preview-panel]]:!relative [&_[data-computer-sidebar]]:!relative"
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
