"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { PanelLeft, Plus, Search, ListTree, Share2 } from "lucide-react";
import { useAuth } from "@/app/hooks/useAuth";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { openCommandPalette } from "@/lib/utils/command-palette";
import type { ChatListData } from "../Sidebar";
import { ShareDialog } from "../ShareDialog";
import { normalizeProBasePath } from "./ProShellContext";

function chatIdFromPath(pathname: string, basePath: string) {
  const normalizedBasePath = normalizeProBasePath(basePath);
  const prefix = `${normalizedBasePath === "/" ? "" : normalizedBasePath}/c/`;
  if (!pathname.startsWith(prefix)) return null;
  return pathname.slice(prefix.length).split("/")[0] || null;
}

function routeTitleFromPath(pathname: string, basePath: string) {
  const normalizedBasePath = normalizeProBasePath(basePath);
  const relativePath =
    normalizedBasePath === "/"
      ? pathname
      : pathname.slice(normalizedBasePath.length) || "/";

  if (relativePath === "/plugins") return "Plugins";
  if (relativePath === "/agents") return "Agents";
  if (relativePath === "/tasks") return "Tasks";
  if (relativePath === "/artifacts") return "Artifacts";
  if (relativePath === "/notebook") return "Pentest notebook";
  if (relativePath === "/studio") return "Studio";
  return "New session";
}

export function ProTitlebar({ chatListData }: { chatListData: ChatListData }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const { basePath, goHome } = useChatNavigation();
  const {
    toggleChatSidebar,
    sidebarOpen,
    setSidebarOpen,
    sidebarContent,
    setSidebarContent,
    initializeNewChat,
    closeSidebar,
  } = useGlobalState();
  const [shareOpen, setShareOpen] = useState(false);
  const currentId = chatIdFromPath(pathname, basePath);

  const currentChat = useMemo(() => {
    if (!currentId) return null;
    return (chatListData.results ?? []).find((chat) => chat.id === currentId);
  }, [chatListData.results, currentId]);

  const title =
    currentChat?.title?.trim() ||
    (currentId ? "Untitled chat" : routeTitleFromPath(pathname, basePath));
  const activityOpen = sidebarOpen && sidebarContent === null;

  if (loading || !user) return null;

  const handleNewChat = () => {
    closeSidebar();
    initializeNewChat();
    goHome();
  };

  const btn =
    "flex size-[26px] items-center justify-center rounded-[5px] text-muted-foreground transition-colors duration-(--duration-hover) hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none";

  return (
    <>
      <header
        data-testid="workbench-titlebar"
        data-rift-native-titlebar="pro"
        data-tauri-drag-region
        className="pro-titlebar flex h-[35px] shrink-0 items-center gap-1.5 border-b border-sidebar-border px-1.5"
      >
        <button
          type="button"
          onClick={toggleChatSidebar}
          aria-label="Toggle sidebar"
          className={btn}
        >
          <PanelLeft aria-hidden className="size-[14px]" strokeWidth={1.6} />
        </button>
        <div className="flex min-w-0 items-center pl-0.5">
          <span className="truncate text-ui-label font-normal leading-4 text-[var(--pro-text-secondary)]">
            {title}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => openCommandPalette()}
            aria-label="Command palette"
            className={btn}
            title="⌘K"
          >
            <Search aria-hidden className="size-[14px]" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            onClick={handleNewChat}
            aria-label="New chat"
            className={btn}
            title="⌘N"
          >
            <Plus aria-hidden className="size-[14px]" strokeWidth={1.6} />
          </button>
          {currentId ? (
            <button
              type="button"
              aria-label="Share"
              className={btn}
              onClick={() => setShareOpen(true)}
            >
              <Share2 aria-hidden className="size-[14px]" strokeWidth={1.6} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (activityOpen) {
                setSidebarOpen(false);
                return;
              }
              setSidebarContent(null);
              setSidebarOpen(true);
            }}
            aria-label="Toggle agent activity"
            aria-expanded={activityOpen}
            title="Agent activity"
            className={`${btn} ${activityOpen ? "bg-sidebar-accent text-foreground" : ""}`}
          >
            <ListTree aria-hidden className="size-[14px]" strokeWidth={1.6} />
          </button>
        </div>
      </header>
      {currentId ? (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          chatId={currentId}
          chatTitle={title}
          existingShareId={currentChat?.share_id}
        />
      ) : null}
    </>
  );
}
