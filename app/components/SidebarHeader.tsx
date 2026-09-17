"use client";

import { useState, useEffect, useSyncExternalStore, FC } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  PanelLeft,
  Plus,
  CircleDashed,
  LockKeyhole,
  ChevronDown,
  Moon,
  Sun,
} from "lucide-react";
import {
  BuildIcon as Blocks,
  StudioIcon as Images,
  HackIcon as Crosshair,
  PluginsIcon as Plug,
  AgentsIcon as Bot,
  RunsIcon as History,
  TasksIcon as ListTodo,
  ArtifactsIcon as LayoutGrid,
  NewChatIcon as SquarePen,
  SearchIcon as Search,
  MoreIcon,
} from "@/lib/ui/workspace-icons";
import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import { useGlobalState } from "../contexts/GlobalState";
import type { ChatPurpose } from "@/types/chat";
import { useIsMobile } from "@/hooks/use-mobile";
import { MessageSearchDialog } from "./MessageSearchDialog";
import {
  chatIdFromPathname,
  useChatNavigation,
} from "@/app/hooks/useChatNavigation";
import { isPurposeChatActive } from "@/lib/navigation/chat-routes";
import { useProShell } from "@/app/components/pro/ProShellContext";
import { openCommandPalette } from "@/lib/utils/command-palette";
import {
  sidebarNavRowClass,
  SIDEBAR_SECTION_LABEL_CLASS,
} from "@/lib/ui/workspace-chrome";
import { hasHackWorkbenchAccess } from "@/lib/auth/premium-access";
import { useWorkspaceNavigation } from "@/app/hooks/useWorkspaceNavigation";
import { WORKSPACE_ITEMS } from "@/lib/navigation/workspace-items";
import { useIsMac } from "@/app/hooks/useIsMac";

const subscribeToHydration = () => () => {};

const MORE_OPEN_KEY = "rift:sidebar:more-open";
const moreOpenListeners = new Set<() => void>();

const subscribeMoreOpen = (notify: () => void) => {
  moreOpenListeners.add(notify);
  return () => {
    moreOpenListeners.delete(notify);
  };
};

const readMoreOpen = () => {
  try {
    return window.localStorage.getItem(MORE_OPEN_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * The fold is a preference, so it outlives the route and the reload. Read
 * through useSyncExternalStore rather than an effect: the server has no
 * storage to read, and the folded state is what it renders either way.
 */
function useSidebarMoreOpen() {
  const open = useSyncExternalStore(
    subscribeMoreOpen,
    readMoreOpen,
    () => false,
  );
  const set = (next: boolean) => {
    try {
      window.localStorage.setItem(MORE_OPEN_KEY, next ? "1" : "0");
    } catch {}
    moreOpenListeners.forEach((notify) => notify());
  };
  return [open, set] as const;
}

export function SidebarThemeToggle({
  variant,
}: {
  variant: "standard" | "collapsed" | "pro";
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const isDark = (resolvedTheme ?? theme ?? "dark") === "dark";
  const nextTheme = isDark ? "light" : "dark";
  const label = isHydrated
    ? `Switch to ${nextTheme} theme`
    : "Toggle color theme";
  const sizing =
    variant === "standard"
      ? "size-7 rounded-md"
      : variant === "pro"
        ? "size-6 rounded-[6px]"
        : "size-8 rounded-md";

  return (
    <button
      data-testid="sidebar-theme-toggle"
      type="button"
      disabled={!isHydrated}
      onClick={() => setTheme(nextTheme)}
      aria-label={label}
      title={label}
      className={`flex items-center justify-center text-[var(--cursor-icon-secondary)] transition-[background-color,color,transform] duration-(--duration-press) ease-(--ease-out) active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100 hover:bg-sidebar-accent/70 hover:text-foreground focus-visible:outline-none disabled:cursor-wait disabled:opacity-60 ${sizing}`}
    >
      {isDark ? (
        <Sun aria-hidden className="size-[14px]" strokeWidth={1.5} />
      ) : (
        <Moon aria-hidden className="size-[14px]" strokeWidth={1.5} />
      )}
    </button>
  );
}

/**
 * The normal chat modes the user can launch from the sidebar. Each opens a fresh
 * chat with the matching ChatPurpose (which drives the system prompt, model, and
 * execution path on the backend). Offensive-security work is intentionally not
 * a chat mode here; it lives only in the Max-gated Hack Workbench.
 */
type SidebarChatPurpose = Extract<ChatPurpose, "app" | "image">;

const MODES = WORKSPACE_ITEMS.filter(
  (item) => item.id === "app" || item.id === "image",
).map((item) => ({
  purpose: item.id as SidebarChatPurpose,
  label: item.label,
  Icon: item.Icon,
  title: `Open ${item.label}`,
}));

/**
 * Sidebar row and section-label styles now live in lib/ui/workspace-chrome, so
 * the landing page's working replica of the workspace can render from the same
 * tokens instead of a copy that drifts. Re-exported here because this module
 * has been their import site for a long time.
 */
export {
  sidebarNavRowClass,
  SIDEBAR_SECTION_LABEL_CLASS,
} from "@/lib/ui/workspace-chrome";

interface SidebarHeaderContentProps {
  /** Function to handle closing the sidebar */
  handleCloseSidebar: () => void;
  /** Whether this is being used in mobile overlay (without SidebarProvider) */
  isMobileOverlay?: boolean;
}

// Shared implementation component
interface SidebarHeaderContentImplProps {
  handleCloseSidebar: () => void;
  closeOnNavigate: boolean;
}

const SidebarHeaderContentImpl: FC<SidebarHeaderContentImplProps> = ({
  handleCloseSidebar,
  closeOnNavigate,
}) => {
  const isMobile = useIsMobile();
  const router = useRouter();
  const pathname = usePathname();
  const {
    setChatSidebarOpen,
    closeSidebar,
    initializeNewChat,
    setTemporaryChatsEnabled,
    chatPurpose,
    subscription,
    isSubscriptionReady,
    toggleChatSidebar,
  } = useGlobalState();
  const { goHome, goPurpose } = useChatNavigation();
  const openWorkspace = useWorkspaceNavigation();
  const { enabled: proShell } = useProShell();
  const premiumAccessPending = !isSubscriptionReady;
  const canUseHack =
    isSubscriptionReady && hasHackWorkbenchAccess(subscription);
  const hackAccessLabel = premiumAccessPending
    ? "Checking plan access for Hack Workbench"
    : canUseHack
      ? "Open Hack Workbench"
      : "Hack Workbench - Max plan required";
  const hackAccessTitle = premiumAccessPending
    ? "Checking plan access…"
    : canUseHack
      ? "Hack Workbench - terminal security operations"
      : "Hack Workbench - exclusive to Max ($129/month)";

  // Search dialog state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  // Detect if user is on Mac
  const isMac = useIsMac();

  // Platform-specific modifier key
  const modifierKey = isMac ? "⌘" : "Ctrl+";
  const buildActive = isPurposeChatActive("app", pathname, chatPurpose);
  const studioActive = isPurposeChatActive("image", pathname, chatPurpose);
  const agentsActive = pathname === "/agents";

  /*
   * Warm every destination the sidebar can reach.
   *
   * These rows are buttons rather than links — they close the mobile drawer
   * and, for Build and Studio, select a chat purpose before navigating — so
   * Next's viewport prefetch never fires for any of them. Only `/studio` and
   * `/` were warmed by hand, which left six of the eight rows paying for
   * their route chunk on the first click. That cost is the whole of what the
   * app felt like when you clicked Agents or Tasks.
   *
   * `/hack` is deliberately absent: it is `force-dynamic` with a server-side
   * auth check and a redirect, so prefetching it fires that round trip for
   * every visitor who never clicks it. `/notebook` has no row.
   */
  useEffect(() => {
    for (const href of [
      "/",
      "/studio",
      "/agents",
      "/runs",
      "/tasks",
      "/plugins",
      "/artifacts",
    ]) {
      router.prefetch(href);
    }
  }, [router]);

  const closeMobileSidebarForNavigation = () => {
    if (closeOnNavigate) handleCloseSidebar();
  };

  const navigateHome = () => {
    closeMobileSidebarForNavigation();
    goHome();
  };

  const navigateTo = (href: string) => {
    closeMobileSidebarForNavigation();
    router.push(href);
  };

  // Add keyboard shortcut for search (Cmd/Ctrl + K)
  useEffect(() => {
    if (proShell) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [proShell]);

  const launchMode = (purpose: SidebarChatPurpose) => {
    closeMobileSidebarForNavigation();
    if (isMobile) setChatSidebarOpen(false);
    openWorkspace(purpose);
  };

  const handleNewChat = () => {
    closeSidebar();
    if (isMobile) setChatSidebarOpen(false);
    // Reset the mounted tree only for the same purpose; the destination owns
    // cross-purpose initialization after the old conversation unmounts.
    if (
      chatPurpose === "app" &&
      isPurposeChatActive("app", pathname, chatPurpose)
    ) {
      initializeNewChat("app");
    }
    setTemporaryChatsEnabled(false);
    closeMobileSidebarForNavigation();
    goPurpose("app");
  };

  const launchHack = () => {
    if (premiumAccessPending) return;
    navigateTo(canUseHack ? "/hack" : "/upgrade?feature=hack");
  };

  const [moreOpen, setMoreOpen] = useSidebarMoreOpen();
  // Reveal a secondary destination on entry, but let a deliberate close win
  // until the route changes. A permanent route OR made the toggle ineffective.
  const [moreRoute, setMoreRoute] = useState({ pathname, dismissed: false });
  if (moreRoute.pathname !== pathname) {
    setMoreRoute({ pathname, dismissed: false });
  }
  const activeRouteInFold =
    agentsActive ||
    pathname === "/plugins" ||
    pathname.startsWith("/runs") ||
    pathname === "/tasks" ||
    pathname === "/artifacts";
  const moreExpanded =
    moreOpen ||
    (activeRouteInFold &&
      !(moreRoute.pathname === pathname && moreRoute.dismissed));
  const toggleMore = () => {
    const next = !moreExpanded;
    setMoreOpen(next);
    setMoreRoute({ pathname, dismissed: !next });
  };

  const handleSearchOpen = () => {
    if (proShell) {
      // A row in the nav behaves like the rest of the nav: on mobile the drawer
      // is covering the palette it is about to open.
      closeMobileSidebarForNavigation();
      openCommandPalette();
      return;
    }
    setIsSearchOpen(true);
  };

  const handleSearchClose = () => {
    setIsSearchOpen(false);
  };

  if (proShell) {
    // The Pro shell used to carry its own copy of the row class, which is how
    // the two shells drifted apart the last time these metrics changed. One
    // source now; the only difference left is the hover fill.
    // Row icons carry no size or stroke of their own. They used to, and the
    // values were a lie: the row's own `[&>svg]` selector is a child selector
    // (0,1,1) and beat every `size-[14px]` (0,1,0) at the call site, so the
    // marks rendered at the token's size no matter what was written here.
    const proNavRow = (active: boolean) =>
      sidebarNavRowClass(active).replace(
        "hover:bg-sidebar-accent/60",
        "hover:bg-sidebar-accent",
      );

    return (
      <>
        {/* The outer sidebar header owns the inset for both nav groups. */}
        <div
          data-pro-sidebar-header
          className="rift-desktop-sidebar-header px-0 pb-0 pt-0"
        >
          {/* No brand row. Neither of the two apps this shell is measured
              against puts its own name in the sidebar -- the window already
              says which app this is, and the row cost four destinations worth
              of vertical space. Search is a destination here for the same
              reason it is one in Cursor: an icon in a header is a thing you
              have to already know about.

              Mobile is the exception, and only because the window strip that
              carries these two controls on desktop is hidden at this width:
              without them the drawer has no way out but the scrim, and the
              theme control has nowhere to live at all. */}
          {isMobile ? (
            <div className="mb-1 flex h-11 items-center">
              <SidebarThemeToggle variant="pro" />
              <button
                type="button"
                onClick={handleCloseSidebar}
                aria-label="Close navigation"
                title="Close navigation"
                className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--cursor-icon-secondary)] transition-[background-color,color,transform] duration-(--duration-press) ease-(--ease-out) active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100 hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
              >
                <PanelLeft
                  aria-hidden
                  className="size-[14px]"
                  strokeWidth={1.6}
                />
              </button>
            </div>
          ) : null}

          <nav aria-label="Primary workspaces" className="space-y-px">
            {!isMobile && (
              <button
                type="button"
                onClick={handleNewChat}
                aria-label="Start new chat"
                aria-current={
                  pathname === "/" && buildActive ? "page" : undefined
                }
                className={proNavRow(pathname === "/" && buildActive)}
              >
                <SquarePen aria-hidden />
                New chat
              </button>
            )}
            <button
              type="button"
              onClick={() => launchMode("app")}
              aria-current={
                buildActive && pathname !== "/" ? "page" : undefined
              }
              className={proNavRow(buildActive && pathname !== "/")}
            >
              <Blocks aria-hidden />
              Build
            </button>
            <button
              type="button"
              onClick={() => launchMode("image")}
              aria-current={studioActive ? "page" : undefined}
              className={proNavRow(studioActive)}
            >
              <Images aria-hidden />
              Studio
            </button>
            <button
              data-testid="sidebar-hack"
              type="button"
              onClick={launchHack}
              disabled={premiumAccessPending}
              aria-busy={premiumAccessPending}
              aria-label={hackAccessLabel}
              aria-current={pathname === "/hack" ? "page" : undefined}
              title={hackAccessTitle}
              className={`${proNavRow(pathname === "/hack")} disabled:cursor-wait disabled:opacity-55`}
            >
              <Crosshair aria-hidden />
              Hack Workbench
              {premiumAccessPending ? (
                <span className="ml-auto flex shrink-0 items-center">
                  <CircleDashed aria-hidden className="size-3" />
                </span>
              ) : !canUseHack ? (
                <span className="ml-auto flex shrink-0 items-center">
                  <LockKeyhole aria-hidden className="size-3 text-primary/80" />
                </span>
              ) : null}
            </button>
          </nav>

          {/* Keep the daily entry points visible; secondary workspaces stay one click away. */}
          <nav aria-label="More workspaces" className="space-y-px">
            <button
              data-testid="sidebar-more-toggle"
              type="button"
              onClick={toggleMore}
              aria-expanded={moreExpanded}
              aria-controls="rift-sidebar-more"
              className={`${proNavRow(false)} text-[var(--cursor-text-tertiary)]`}
            >
              <MoreIcon aria-hidden />
              More
              {!moreExpanded && activeRouteInFold ? (
                <span
                  aria-hidden
                  className="ml-auto size-1 rounded-full bg-current"
                />
              ) : null}
            </button>

            {moreExpanded ? (
              <div id="rift-sidebar-more" className="space-y-px">
                <button
                  type="button"
                  onClick={() => navigateTo("/plugins")}
                  aria-current={pathname === "/plugins" ? "page" : undefined}
                  className={proNavRow(pathname === "/plugins")}
                >
                  <Plug aria-hidden />
                  Plugins
                </button>
                {isMobile ? (
                  <button
                    type="button"
                    onClick={handleSearchOpen}
                    aria-label="Search chats"
                    data-testid="sidebar-search-row"
                    className={proNavRow(false)}
                  >
                    <Search aria-hidden />
                    Search
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => navigateTo("/agents")}
                  aria-current={agentsActive ? "page" : undefined}
                  className={proNavRow(agentsActive)}
                >
                  <Bot aria-hidden />
                  Agents
                </button>

                <button
                  type="button"
                  onClick={() => navigateTo("/runs")}
                  aria-current={
                    pathname.startsWith("/runs") ? "page" : undefined
                  }
                  className={proNavRow(pathname.startsWith("/runs"))}
                >
                  <History aria-hidden />
                  Runs
                </button>

                <button
                  type="button"
                  onClick={() => navigateTo("/tasks")}
                  aria-current={pathname === "/tasks" ? "page" : undefined}
                  className={proNavRow(pathname === "/tasks")}
                >
                  <ListTodo aria-hidden />
                  Tasks
                </button>

                <button
                  type="button"
                  onClick={() => navigateTo("/artifacts")}
                  aria-current={pathname === "/artifacts" ? "page" : undefined}
                  className={proNavRow(pathname === "/artifacts")}
                >
                  <LayoutGrid aria-hidden />
                  Artifacts
                </button>
              </div>
            ) : null}
          </nav>
        </div>

        <MessageSearchDialog
          isOpen={isSearchOpen}
          onClose={handleSearchClose}
        />
      </>
    );
  }

  return (
    <>
      {/* Workspace controls sit at the top and carry the desktop traffic-light
          clearance. Build / Image start fresh chats; Hack opens the dedicated
          premium terminal workspace. */}
      {/* Collapse toggle — slim top control; carries the desktop traffic-light
          clearance as the topmost element. */}
      <div
        data-rift-native-titlebar="sidebar"
        data-tauri-drag-region
        className="rift-desktop-sidebar-header flex items-center justify-between gap-2 px-2.5 pb-1 pt-2"
      >
        <button
          type="button"
          onClick={navigateHome}
          aria-label="RIFT home"
          className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
        >
          <RiftBrandLockup
            decorative
            markSize={26}
            textSize={14}
            gap={8}
            markClassName="text-foreground"
          />
        </button>
        <button
          type="button"
          onClick={toggleChatSidebar}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--cursor-icon-secondary)] transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
        >
          <PanelLeft aria-hidden className="size-[14px]" strokeWidth={1.5} />
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleSearchOpen}
            aria-label="Search chats"
            title={`Search chats (${modifierKey}K)`}
            className="flex size-7 items-center justify-center rounded-md text-[var(--cursor-icon-secondary)] transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
          >
            <Search aria-hidden className="size-[14px]" strokeWidth={1.5} />
          </button>
          <SidebarThemeToggle variant="standard" />
        </div>
      </div>

      {/* Cursor keeps the primary action stack unlabelled and compact. */}
      <div className="px-2 pb-1.5 pt-1.5">
        <nav aria-label="Primary workspaces" className="space-y-px">
          {!isMobile && (
            <button
              type="button"
              onClick={handleNewChat}
              aria-label="Start new chat"
              className={sidebarNavRowClass(false)}
            >
              <Plus aria-hidden />
              New chat
            </button>
          )}

          <button
            type="button"
            onClick={() => launchMode("app")}
            aria-current={buildActive ? "page" : undefined}
            title={MODES[0].title}
            className={sidebarNavRowClass(buildActive)}
          >
            <Blocks aria-hidden />
            Build
          </button>

          <button
            type="button"
            onClick={() => launchMode("image")}
            aria-current={studioActive ? "page" : undefined}
            title={MODES[1].title}
            className={sidebarNavRowClass(studioActive)}
          >
            <Images aria-hidden />
            Studio
          </button>

          <button
            data-testid="sidebar-hack"
            type="button"
            onClick={launchHack}
            disabled={premiumAccessPending}
            aria-busy={premiumAccessPending}
            aria-label={hackAccessLabel}
            aria-current={pathname === "/hack" ? "page" : undefined}
            title={hackAccessTitle}
            className={`${sidebarNavRowClass(pathname === "/hack")} disabled:cursor-wait disabled:opacity-60`}
          >
            <Crosshair aria-hidden />
            Hack Workbench
            {premiumAccessPending ? (
              <span className="ml-auto flex shrink-0 items-center">
                <CircleDashed aria-hidden className="size-3" />
              </span>
            ) : !canUseHack ? (
              <span className="ml-auto flex shrink-0 items-center">
                <LockKeyhole aria-hidden className="size-3 text-primary/80" />
              </span>
            ) : null}
          </button>
        </nav>
      </div>

      {/* Utility nav is a uniform, tightly-stacked list. Search moved
          to an icon by the collapse toggle; Projects to its own section below.

          /notebook and /appearance are deliberately absent. /notebook already
          redirects to /hack (lib/routing/compatibility-redirects.ts), so the
          notebook is reached through the Hack Workbench that owns it rather
          than advertised to every account as a separate destination.
          Appearance is a settings surface and belongs with the rest of
          settings, not in the destination list. */}
      <nav aria-label="More workspaces" className="mx-2 space-y-px pb-1">
        <button
          data-testid="sidebar-more-toggle"
          type="button"
          onClick={toggleMore}
          aria-expanded={moreExpanded}
          aria-controls="rift-sidebar-more"
          className={sidebarNavRowClass(false)}
        >
          <ChevronDown
            aria-hidden
            className={`transition-transform duration-(--duration-hover) ${moreExpanded ? "" : "-rotate-90"} motion-reduce:transition-none`}
          />
          More
          {!moreExpanded && activeRouteInFold ? (
            <span
              aria-hidden
              className="ml-auto size-1 rounded-full bg-current"
            />
          ) : null}
        </button>
        {moreExpanded ? (
          <div id="rift-sidebar-more" className="space-y-px">
            <button
              type="button"
              onClick={() => navigateTo("/agents")}
              aria-current={agentsActive ? "page" : undefined}
              title="Agents and teams"
              className={sidebarNavRowClass(agentsActive)}
            >
              <Bot aria-hidden />
              Agents
            </button>

            <button
              type="button"
              onClick={() => navigateTo("/runs")}
              aria-current={pathname.startsWith("/runs") ? "page" : undefined}
              title="Runs and their evidence"
              className={sidebarNavRowClass(pathname.startsWith("/runs"))}
            >
              <History aria-hidden />
              Runs
            </button>

            <button
              type="button"
              onClick={() => navigateTo("/tasks")}
              aria-current={pathname === "/tasks" ? "page" : undefined}
              title="Tasks and schedules"
              className={sidebarNavRowClass(pathname === "/tasks")}
            >
              <ListTodo aria-hidden />
              Tasks
            </button>

            <button
              type="button"
              onClick={() => navigateTo("/plugins")}
              aria-current={pathname === "/plugins" ? "page" : undefined}
              title="Plugins - connect MCP servers and tools"
              className={sidebarNavRowClass(pathname === "/plugins")}
            >
              <Plug aria-hidden />
              Plugins
            </button>

            <button
              type="button"
              onClick={() => navigateTo("/artifacts")}
              aria-current={pathname === "/artifacts" ? "page" : undefined}
              title="Artifacts - all your images, sent and generated"
              className={sidebarNavRowClass(pathname === "/artifacts")}
            >
              <LayoutGrid aria-hidden />
              Artifacts
            </button>
          </div>
        ) : null}
      </nav>

      <MessageSearchDialog isOpen={isSearchOpen} onClose={handleSearchClose} />
    </>
  );
};

// The desktop shell and the mobile overlay render the same header. They used
// to be two components because the desktop one called useSidebar() for a
// collapse toggle that only the icon rail used; with the rail gone the only
// difference left is whether navigating closes the sidebar behind you.
const SidebarHeaderContent: FC<SidebarHeaderContentProps> = ({
  handleCloseSidebar,
  isMobileOverlay = false,
}) => (
  <SidebarHeaderContentImpl
    handleCloseSidebar={handleCloseSidebar}
    closeOnNavigate={isMobileOverlay}
  />
);

export default SidebarHeaderContent;
