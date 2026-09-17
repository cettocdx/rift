"use client";

import { RootShellPresence } from "@/app/components/RootShellPresence";

import { useEffect, useRef, useCallback, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Menu, PanelLeft, Plus, Search, SquarePen } from "lucide-react";
import { useIsDesktopShell } from "@/app/hooks/useTauri";
import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";
import { openCommandPalette } from "@/lib/utils/command-palette";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useChats } from "@/app/hooks/useChats";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { SidebarProvider } from "@/components/ui/sidebar";
import MainSidebar from "../Sidebar";
import SidebarUserNav from "../SidebarUserNav";
import { ProCommandPalette } from "./ProCommandPalette";
import { ProShortcutsDialog } from "./ProShortcutsDialog";
import { TerminalDock } from "@/app/components/terminal/TerminalDock";
import { RiftAgentConsoleProvider } from "@/app/components/terminal/RiftAgentConsoleContext";
import { RiftConsoleConnection } from "../terminal/RiftConsoleConnection";
import { useProKeyboardShortcuts } from "./useProKeyboardShortcuts";
import { useResizableAppSidebar } from "@/app/hooks/useResizableAppSidebar";
import { AppSidebarResizeHandle } from "../AppSidebarResizeHandle";
import { WorkspaceHistoryNavigation } from "./WorkspaceHistoryNavigation";
import { workspaceTitle } from "@/lib/navigation/workspace-items";
import { rememberSettingsReturn } from "@/lib/navigation/settings-return";
import { AppLaunchComplete } from "@/components/launch/AppLaunchProvider";

type MobilePage = Readonly<{
  title: string;
  primaryPurpose?: "app" | "image";
}>;

/** Route-aware copy for the compact mobile shell header. */
export function getProMobilePage(pathname: string): MobilePage {
  if (pathname === "/studio" || pathname.startsWith("/studio/")) {
    return { title: "Studio", primaryPurpose: "image" };
  }
  if (pathname === "/agents" || pathname.startsWith("/agents/")) {
    return { title: "Agents" };
  }
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return { title: "Settings" };
  }
  if (pathname === "/artifacts" || pathname.startsWith("/artifacts/")) {
    return { title: "Artifacts" };
  }
  if (pathname === "/plugins" || pathname.startsWith("/plugins/")) {
    return { title: "Plugins" };
  }
  if (pathname === "/tasks" || pathname.startsWith("/tasks/")) {
    return { title: "Tasks" };
  }
  if (pathname === "/runs" || pathname.startsWith("/runs/"))
    return { title: "Runs" };
  if (pathname === "/notebook" || pathname.startsWith("/notebook/")) {
    return { title: "Notebook" };
  }

  return { title: "Build", primaryPurpose: "app" };
}

export function ProChatLayout({ children }: { children: React.ReactNode }) {
  useProKeyboardShortcuts();
  const isMobile = useIsMobile();
  // Which reference this shell follows. The two do not agree about the rail
  // head, so the answer has to be known before it is drawn.
  const isDesktopShell = useIsDesktopShell();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const isSettingsRoute = /\/settings(?:\/|$)/.test(pathname);
  const {
    chatSidebarOpen,
    setChatSidebarOpen,
    chatPurpose,
    initializeNewChat,
    setTemporaryChatsEnabled,
  } = useGlobalState();
  const { goPurpose } = useChatNavigation();
  const isBuildHome = pathname === "/" && chatPurpose === "app";
  const panelRef = useRef<HTMLDivElement>(null);
  const [drawerVisible, setDrawerVisible] = useState(chatSidebarOpen);
  if (chatSidebarOpen && !drawerVisible) setDrawerVisible(true);
  useEffect(() => {
    if (chatSidebarOpen) return;
    const timer = window.setTimeout(() => setDrawerVisible(false), 200);
    return () => window.clearTimeout(timer);
  }, [chatSidebarOpen]);
  const chatListData = useChats();
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const drawerPathRef = useRef(pathname);
  const mobilePage = getProMobilePage(pathname);
  const sidebarResize = useResizableAppSidebar(
    isMobile === false && chatSidebarOpen,
  );

  useEffect(() => {
    rememberSettingsReturn(
      `${pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [pathname, query]);

  // Account-menu links and browser history also navigate, without going
  // through the sidebar's item handlers. Never leave the destination covered.
  useEffect(() => {
    const changed = drawerPathRef.current !== pathname;
    drawerPathRef.current = pathname;
    if (changed && isMobile) setChatSidebarOpen(false);
  }, [pathname, isMobile, setChatSidebarOpen]);

  useEffect(() => {
    if (pathname === "/" && chatPurpose === "security") {
      initializeNewChat("app");
    }
  }, [chatPurpose, initializeNewChat, pathname]);

  useEffect(() => {
    if (!isMobile || !chatSidebarOpen) return;
    previousActiveElementRef.current = document.activeElement as HTMLElement;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const getFocusableElements = (container: HTMLElement) => {
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

    const focusFirstElement = () => {
      if (!panelRef.current) return;
      getFocusableElements(panelRef.current)[0]?.focus?.();
      if (document.activeElement === previousActiveElementRef.current) {
        panelRef.current.focus();
      }
    };

    const timeoutId = window.setTimeout(focusFirstElement, 0);
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
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previousActiveElementRef.current?.focus?.();
    };
  }, [isMobile, chatSidebarOpen, setChatSidebarOpen]);

  const handleMobilePrimaryAction = useCallback(() => {
    const purpose = mobilePage.primaryPurpose;
    if (!purpose) return;

    setChatSidebarOpen(false);
    initializeNewChat(purpose);
    setTemporaryChatsEnabled(false);
    goPurpose(purpose);
  }, [
    goPurpose,
    initializeNewChat,
    mobilePage.primaryPurpose,
    setChatSidebarOpen,
    setTemporaryChatsEnabled,
  ]);

  return (
    <RiftAgentConsoleProvider routeKey={pathname}>
      <div
        data-pro-workbench
        data-chat-sidebar-open={chatSidebarOpen}
        data-settings-active={isSettingsRoute || undefined}
        data-build-home={isBuildHome || undefined}
        className="pro-shell relative flex min-h-0 flex-1 flex-col overflow-hidden"
        style={
          {
            "--rift-navigation-width": `${sidebarResize.width}px`,
          } as React.CSSProperties
        }
      >
        <RootShellPresence kind="pro" />
        {pathname !== "/" && !pathname.startsWith("/c/") && (
          <AppLaunchComplete />
        )}
        <a
          href="#rift-pro-main"
          className="fixed left-3 top-3 z-[100] -translate-y-[calc(100%+1rem)] rounded-md border border-border bg-popover px-3 py-2 text-ui font-medium text-popover-foreground focus-visible:shadow-lg transition-transform duration-150 focus-visible:translate-y-0 focus-visible:outline-none motion-reduce:transition-none"
        >
          Skip to content
        </a>
        <div
          data-rift-native-titlebar="window"
          data-tauri-drag-region="deep"
          className="rift-native-window-drag-strip"
          // The strip spans the whole window, but the title inside it belongs to
          // the CONTENT pane, not the sidebar. Publishing the sidebar's live
          // width lets the spacer below start the title at the divider, so the
          // two never overlap while the sidebar is resized.
          style={
            {
              "--rift-sidebar-w":
                isMobile === false && isSettingsRoute
                  ? `${sidebarResize.width}px`
                  : isMobile === false && chatSidebarOpen
                    ? `${sidebarResize.width}px`
                    : "0px",
            } as React.CSSProperties
          }
        >
          {isMobile === false ? (
            <>
              {/* The rail head. The two references do NOT agree here, so this
              follows whichever one the user is actually in -- measured from
              each, not generalised from one.
                WEB (cursor.com): the mark at the far left, then the toggle and
              a small Search button riding the rail's right edge. Search is a
              button because the web rail has no room to spend a row on it, and
              it leaves with the rail it searches.
                DESKTOP (Cursor.app): no mark at all -- the window already says
              which app this is -- and the strip carries ONLY the toggle while
              the rail is open, because the rail itself lists Search as a row.
              Collapse the rail and its two most-used destinations are promoted
              into the strip instead: Search, then New chat. So the two shells
              show Search at opposite times, and that is deliberate. */}
              <div
                data-ui="strip-rail-head"
                className="flex shrink-0 items-center"
                style={
                  chatSidebarOpen || isSettingsRoute
                    ? {
                        width:
                          "calc(var(--rift-sidebar-w, 0px) - var(--rift-window-left-inset, 8px))",
                      }
                    : undefined
                }
              >
                {isDesktopShell ? null : (
                  <RiftPixelMark size={26} className="shrink-0" />
                )}
                <div className="min-w-0 flex-1" />
                <button
                  data-testid="collapsed-sidebar-toggle"
                  type="button"
                  aria-label={
                    chatSidebarOpen ? "Close sidebar" : "Open sidebar"
                  }
                  aria-expanded={chatSidebarOpen}
                  aria-controls="rift-pro-sidebar"
                  title={chatSidebarOpen ? "Close sidebar" : "Open sidebar"}
                  onClick={() => setChatSidebarOpen(!chatSidebarOpen)}
                  className="rift-collapsed-sidebar-toggle flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--cursor-icon-secondary)] transition-colors duration-(--duration-hover) hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
                >
                  <PanelLeft
                    aria-hidden
                    className="size-[14px]"
                    strokeWidth={1.6}
                  />
                </button>
                {(isDesktopShell ? !chatSidebarOpen : chatSidebarOpen) ? (
                  <button
                    data-testid="strip-search"
                    type="button"
                    aria-label="Search"
                    title="Search (⌘K)"
                    onClick={() => openCommandPalette()}
                    className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--cursor-icon-secondary)] transition-colors duration-(--duration-hover) hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
                  >
                    <Search
                      aria-hidden
                      className="size-[14px]"
                      strokeWidth={1.6}
                    />
                  </button>
                ) : null}
                {/* New chat rides beside Search for the same reason: with the rail
                gone, the strip is the only place either one still exists. */}
                {isDesktopShell && !chatSidebarOpen ? (
                  <button
                    data-testid="strip-new-chat"
                    type="button"
                    aria-label="New chat"
                    title="New chat"
                    onClick={() => {
                      initializeNewChat("app");
                      setTemporaryChatsEnabled(false);
                      goPurpose("app");
                    }}
                    className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--cursor-icon-secondary)] transition-colors duration-(--duration-hover) hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
                  >
                    <Plus
                      aria-hidden
                      className="size-[14px]"
                      strokeWidth={1.6}
                    />
                  </button>
                ) : null}
              </div>
              <WorkspaceHistoryNavigation />
              <div
                id="rift-window-title-slot"
                data-ui="window-title-slot"
                className="ml-3 flex min-w-0 flex-1 items-center"
              >
                <span className="rift-window-page-title truncate">
                  {workspaceTitle(pathname)}
                </span>
              </div>
              <div
                id="rift-window-actions-slot"
                data-ui="window-actions-slot"
                className="ml-auto flex shrink-0 items-center gap-0.5 pr-2"
              />
            </>
          ) : null}
        </div>
        <div
          data-pro-workbench-body
          className="relative flex min-h-0 flex-1 flex-col"
        >
          <header
            data-pro-mobile-app-bar
            className="relative z-30 shrink-0 border-b border-border bg-[var(--pro-main-bg)] pt-[env(safe-area-inset-top)] md:hidden"
          >
            <div className="flex h-[52px] items-center gap-1 px-1.5">
              <button
                type="button"
                aria-controls="rift-mobile-navigation"
                aria-expanded={isMobile === true && chatSidebarOpen}
                aria-label="Open navigation"
                onClick={() => setChatSidebarOpen(true)}
                className="flex size-11 shrink-0 items-center justify-center rounded-[8px] text-[var(--cursor-icon-secondary)] transition-colors duration-(--duration-hover) hover:bg-accent hover:text-foreground focus-visible:outline-none active:bg-accent motion-reduce:transition-none"
              >
                <Menu aria-hidden className="size-[18px]" strokeWidth={1.6} />
              </button>

              <div className="min-w-0 flex-1 px-1">
                <span
                  data-testid="pro-mobile-page-title"
                  className="block truncate text-ui font-medium tracking-[-0.01em] text-foreground"
                >
                  {mobilePage.primaryPurpose === "app"
                    ? "RIFT"
                    : mobilePage.title}
                </span>
              </div>

              {mobilePage.primaryPurpose ? (
                <button
                  type="button"
                  aria-label={
                    mobilePage.primaryPurpose === "image"
                      ? "Start a new Studio creation"
                      : "Start a new Build chat"
                  }
                  onClick={handleMobilePrimaryAction}
                  className="flex size-11 shrink-0 items-center justify-center rounded-[8px] text-[var(--cursor-icon-secondary)] transition-colors duration-(--duration-hover) hover:bg-accent hover:text-foreground focus-visible:outline-none active:bg-accent motion-reduce:transition-none"
                >
                  <SquarePen aria-hidden className="size-5" strokeWidth={1.7} />
                </button>
              ) : null}
            </div>
          </header>
          <div className="pro-workspace flex min-h-0 flex-1 overflow-hidden">
            {isMobile === false && chatSidebarOpen && !isSettingsRoute ? (
              <div
                id="rift-pro-sidebar"
                data-testid="sidebar"
                data-rift-sidebar-panel
                className="pro-sidebar relative flex h-full w-[279px] shrink-0 flex-col overflow-visible border-r border-sidebar-border"
                style={{ width: `${sidebarResize.width}px` }}
              >
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <SidebarProvider
                    open={chatSidebarOpen}
                    onOpenChange={setChatSidebarOpen}
                    defaultOpen
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
                {/* One child, and it must be the account nav's own `.relative`
                  root: `.pro-sidebar-footer` is a fixed 52px box that lays its
                  direct child out as the row, so a wrapper here collapses the
                  account into a clipped stack. Theme lives in the account menu,
                  which is the one place it is reachable from every route. */}
                <div className="pro-sidebar-footer shrink-0 border-t border-sidebar-border px-1.5 pb-3 pt-2">
                  <SidebarUserNav identityMode="name-only" />
                </div>
                <AppSidebarResizeHandle
                  handleProps={sidebarResize.handleProps}
                  isResizing={sidebarResize.isResizing}
                />
              </div>
            ) : null}
            <main
              id="rift-pro-main"
              data-rift-main-panel
              tabIndex={-1}
              className="pro-main rift-cursor-app relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
            >
              {children}
            </main>
          </div>
        </div>
        {/* Stay inside ChatViewport: a software keyboard can shrink/offset the
          visible shell while 100dvh still describes the full layout viewport. */}
        {isMobile === true && (chatSidebarOpen || drawerVisible) && (
          <div
            className="absolute inset-0 z-[70] flex bg-[var(--app-scrim)]"
            data-mobile-navigation-overlay
            data-state={chatSidebarOpen ? "open" : "closed"}
            inert={!chatSidebarOpen}
            aria-hidden={!chatSidebarOpen || undefined}
            onClick={() => setChatSidebarOpen(false)}
          >
            <div
              id="rift-mobile-navigation"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="rift-mobile-navigation-title"
              tabIndex={-1}
              data-mobile-navigation-drawer
              data-rift-sidebar-panel
              className="pro-sidebar h-full min-h-0 w-[min(88vw,320px)] border-r border-sidebar-border pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-[0_24px_80px_var(--app-scrim)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="rift-mobile-navigation-title" className="sr-only">
                Navigation
              </h2>
              <MainSidebar isMobileOverlay chatListData={chatListData} />
            </div>
          </div>
        )}
        <ProCommandPalette />
        <ProShortcutsDialog />
        <TerminalDock />
        <RiftConsoleConnection />
      </div>
    </RiftAgentConsoleProvider>
  );
}
