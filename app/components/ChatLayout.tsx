"use client";

import { RootShellPresence } from "@/app/components/RootShellPresence";

import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGlobalState } from "../contexts/GlobalState";
import { useChats } from "../hooks/useChats";
import { SidebarProvider } from "@/components/ui/sidebar";
import MainSidebar from "./Sidebar";
import SidebarUserNav from "./SidebarUserNav";
import { ChatTitlebar } from "./ChatTitlebar";
import { useResizableAppSidebar } from "../hooks/useResizableAppSidebar";
import { AppSidebarResizeHandle } from "./AppSidebarResizeHandle";

/**
 * Shared layout for chat routes: Chat Sidebar (left) + main content slot.
 * Stays mounted across / and /c/[id] navigation so the sidebar does not re-render.
 * Does NOT include the Computer Sidebar (right); that remains in ChatContent.
 */
export function ChatLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const { chatSidebarOpen, setChatSidebarOpen } = useGlobalState();
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep chat list subscription in layout so it doesn't refetch when sidebar opens/closes
  const chatListData = useChats();
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const sidebarResize = useResizableAppSidebar(
    isMobile === false && chatSidebarOpen,
  );

  // Escape key handler and focus trap for mobile overlay
  useEffect(() => {
    if (!isMobile || !chatSidebarOpen) return;

    // Store the previously focused element
    previousActiveElementRef.current = document.activeElement as HTMLElement;

    // Focus trap: Get all focusable elements within the panel
    const getFocusableElements = (container: HTMLElement): HTMLElement[] => {
      const selector = [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        '[tabindex]:not([tabindex="-1"])',
      ].join(", ");
      return Array.from(container.querySelectorAll<HTMLElement>(selector));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChatSidebarOpen(false);
        return;
      }

      if (e.key !== "Tab" || !panelRef.current) return;

      const focusableElements = getFocusableElements(panelRef.current);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, move to last
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: if focus is on last element, move to first
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    // Focus the first focusable element when overlay opens
    const focusFirstElement = () => {
      if (panelRef.current) {
        const focusableElements = getFocusableElements(panelRef.current);
        if (focusableElements.length > 0) {
          focusableElements[0].focus();
        } else {
          // If no focusable elements, focus the panel itself
          panelRef.current.focus();
        }
      }
    };

    // Small delay to ensure panel is rendered
    const timeoutId = setTimeout(focusFirstElement, 0);

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to previously focused element
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isMobile, chatSidebarOpen, setChatSidebarOpen]);

  return (
    <div
      data-rift-workspace
      data-chat-sidebar-open={chatSidebarOpen}
      className="relative flex min-h-0 flex-1 w-full flex-col overflow-hidden bg-background"
    >
      <RootShellPresence kind="workspace" />
      <ChatTitlebar chatListData={chatListData} />
      <div className="flex min-h-0 flex-1 w-full overflow-hidden">
        {/* Desktop sidebar mounts only while open. The native titlebar owns the
            single reopen affordance beside the macOS traffic lights. */}
        {isMobile === false &&
          (chatSidebarOpen ? (
            <div
              data-testid="sidebar"
              data-rift-sidebar-panel
              className="relative flex h-full min-h-0 w-[279px] shrink-0 flex-col overflow-visible border-r border-sidebar-border bg-sidebar"
              style={{ width: `${sidebarResize.width}px` }}
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <SidebarProvider
                  open={chatSidebarOpen}
                  onOpenChange={setChatSidebarOpen}
                  defaultOpen={true}
                  className="h-full min-h-0"
                  style={
                    {
                      "--sidebar-width": `${sidebarResize.width}px`,
                    } as React.CSSProperties
                  }
                >
                  <MainSidebar chatListData={chatListData} />
                </SidebarProvider>
              </div>
              <div
                data-testid="sidebar-session-dock"
                className="shrink-0 border-t border-sidebar-border bg-sidebar px-2 pb-2 pt-2"
              >
                <SidebarUserNav identityMode="name-only" />
              </div>
              <AppSidebarResizeHandle
                handleProps={sidebarResize.handleProps}
                isResizing={sidebarResize.isResizing}
              />
            </div>
          ) : null)}

        {/* Main content slot - pages render here */}
        <main
          data-rift-main-panel
          className="rift-cursor-app flex min-h-0 flex-1 min-w-0 flex-col relative bg-background"
        >
          {children}
        </main>

        {/* Overlay Chat Sidebar - Mobile: only when resolved to mobile */}
        {isMobile === true && chatSidebarOpen && (
          <div
            className="fixed inset-0 z-40 flex bg-[var(--app-scrim)]"
            onClick={() => setChatSidebarOpen(false)}
          >
            <div
              ref={panelRef}
              data-rift-sidebar-panel
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              className="h-full w-full max-w-80 border-r border-sidebar-border bg-sidebar shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <MainSidebar isMobileOverlay={true} chatListData={chatListData} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
