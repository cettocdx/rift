"use client";

import { PanelLeft } from "lucide-react";
import { useAuth } from "@/app/hooks/useAuth";
import { useGlobalState } from "@/app/contexts/GlobalState";
import type { ChatListData } from "./Sidebar";

interface ChatTitlebarProps {
  chatListData: ChatListData;
}

/**
 * Minimal native window strip. Reserves space for the macOS traffic lights and
 * provides the draggable region plus the sidebar toggle (left). Settings now
 * lives in the bottom user menu (see SidebarUserNav).
 */
export function ChatTitlebar(_props: ChatTitlebarProps) {
  const { user, loading } = useAuth();
  const { toggleChatSidebar, chatSidebarOpen } = useGlobalState();

  if (loading || !user) return null;

  const btn =
    "pointer-events-auto flex h-[26px] w-[26px] items-center justify-center rounded-md border border-sidebar-border bg-sidebar text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent/60";

  // Transparent, absolutely-positioned drag strip overlaying the very top of the
  // app — instead of a full-width bar that pushes everything down and paints a
  // seam over the content. The sidebar (bg-sidebar) and the content
  // (bg-background) now each fill up to the very top with no cut, while this
  // still reserves the macOS traffic-light area (pl-[78px]) and provides the
  // window drag region on desktop. pointer-events-none lets clicks fall through
  // to whatever is beneath; only the reopen toggle re-enables pointer events.
  return (
    <header
      className="rift-titlebar pointer-events-none absolute inset-x-0 top-0 z-30 flex h-9 items-center gap-1 px-3 pl-[78px] max-md:pl-3"
      data-rift-native-titlebar="window"
      data-tauri-drag-region
      data-testid="chat-titlebar"
    >
      {/* When the sidebar is fully closed this is its only reopen affordance,
          aligned immediately after the native macOS traffic lights. */}
      {!chatSidebarOpen && (
        <button
          type="button"
          onClick={toggleChatSidebar}
          aria-label="Open sidebar"
          title="Open sidebar"
          data-testid="collapsed-sidebar-toggle"
          className={`rift-collapsed-sidebar-toggle ${btn}`}
        >
          <PanelLeft aria-hidden className="size-4" />
        </button>
      )}
    </header>
  );
}
