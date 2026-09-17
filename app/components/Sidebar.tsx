"use client";

import { FC, useRef } from "react";
import { useGlobalState } from "../contexts/GlobalState";
import { useIsMobile } from "@/hooks/use-mobile";
import { useChats } from "../hooks/useChats";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { MobileSidebarFooter } from "./MobileSidebarFooter";
import { useConversationStatuses } from "@/app/hooks/useConversationStatuses";
import SidebarHeaderContent from "./SidebarHeader";
import { SidebarGithub } from "./SidebarGithub";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarActiveRuns } from "./SidebarActiveRuns";

/** Chat list data lifted from parent so the subscription stays active when sidebar closes. */
export type ChatListData = ReturnType<typeof useChats>;

// ChatList component content - receives data from parent to avoid refetch on open/close
const ChatListContent: FC<{
  chatListData: ChatListData;
  scrollWithHeader?: boolean;
}> = ({ chatListData, scrollWithHeader = false }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const chats = useConversationStatuses(chatListData.results || []);

  return (
    <div
      className={
        scrollWithHeader ? "flex flex-col" : "flex h-full min-h-0 flex-col"
      }
    >
      {/* Security operations live only in the dedicated Hack Workbench. */}

      {/* What is running right now, above the history it would otherwise be
          buried in. Renders nothing when nothing is running, so the rail is
          unchanged for the common case. */}
      <SidebarActiveRuns />

      {/* Build and Image chat history fills the remaining sidebar. */}
      <div
        className={
          scrollWithHeader
            ? "overflow-x-hidden"
            : "min-h-0 flex-1 overflow-y-auto overflow-x-hidden terminal-scrollbar"
        }
        ref={scrollContainerRef}
        data-testid="sidebar-chat-list-scroll-container"
      >
        <SidebarGithub chats={chats} />
        <SidebarProjects
          chats={chats}
          paginationStatus={chatListData.status}
          loadMore={chatListData.loadMore}
        />
      </div>
    </div>
  );
};

// Desktop-only sidebar content (requires SidebarProvider context)
const DesktopSidebarContent: FC<{
  isMobile: boolean;
  handleCloseSidebar: () => void;
  chatListData: ChatListData;
}> = ({ isMobile, handleCloseSidebar, chatListData }) => {
  return (
    <Sidebar
      side="left"
      collapsible="none"
      className={isMobile ? "w-full" : undefined}
    >
      {/* workspace.css owns the shared 8px inset and clears the native strip.
          Keep the fallback compact for surfaces without the Pro shell. */}
      <SidebarHeader className="px-1.5 pb-0 pt-2 md:pt-0.5">
        <SidebarHeaderContent handleCloseSidebar={handleCloseSidebar} />
      </SidebarHeader>

      <SidebarContent className="min-h-0 flex-1">
        <SidebarGroup className="min-h-0 flex-1 overflow-hidden px-0">
          <SidebarGroupContent className="h-full min-h-0">
            <ChatListContent chatListData={chatListData} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
};

interface MainSidebarProps {
  isMobileOverlay?: boolean;
  /** When provided (e.g. from ChatLayout), avoids refetching when sidebar opens/closes */
  chatListData?: ChatListData;
}

interface MainSidebarContentProps {
  isMobileOverlay: boolean;
  chatListData: ChatListData;
}

const MainSidebarContent: FC<MainSidebarContentProps> = ({
  isMobileOverlay,
  chatListData,
}) => {
  const isMobile = useIsMobile();
  const { setChatSidebarOpen } = useGlobalState();

  const handleCloseSidebar = () => {
    setChatSidebarOpen(false);
  };

  // Mobile overlay version - simplified without Sidebar wrapper
  if (isMobileOverlay) {
    return (
      <>
        {/* The overlay panel that wraps this already paints the sidebar fill
            and the divider; repeating them here stacked a second translucent
            layer on the first. */}
        <div className="flex h-full w-full flex-col">
          {/* Expanded navigation can exceed a keyboard-reduced viewport. Let
              the header and repositories share one scroller above the footer. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain terminal-scrollbar">
            <SidebarHeaderContent
              handleCloseSidebar={handleCloseSidebar}
              isMobileOverlay
            />
            <ChatListContent chatListData={chatListData} scrollWithHeader />
          </div>

          <MobileSidebarFooter onNavigate={handleCloseSidebar} />
        </div>
      </>
    );
  }

  return (
    <DesktopSidebarContent
      isMobile={isMobile ?? false}
      handleCloseSidebar={handleCloseSidebar}
      chatListData={chatListData}
    />
  );
};

// Keep the fallback subscription in a separate component. Calling useChats
// unconditionally in MainSidebar created a second live Convex subscription
// even when ChatLayout had already lifted and supplied the same result.
const MainSidebarWithSubscription: FC<{
  isMobileOverlay: boolean;
}> = ({ isMobileOverlay }) => {
  const chatListData = useChats();
  return (
    <MainSidebarContent
      isMobileOverlay={isMobileOverlay}
      chatListData={chatListData}
    />
  );
};

const MainSidebar: FC<MainSidebarProps> = ({
  isMobileOverlay = false,
  chatListData,
}) =>
  chatListData ? (
    <MainSidebarContent
      isMobileOverlay={isMobileOverlay}
      chatListData={chatListData}
    />
  ) : (
    <MainSidebarWithSubscription isMobileOverlay={isMobileOverlay} />
  );

export default MainSidebar;
