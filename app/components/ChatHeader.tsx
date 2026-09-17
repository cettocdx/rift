"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/app/hooks/useAuth";
import { PanelLeft, SquarePen, HatGlasses, Split, Share } from "lucide-react";
import { useGlobalState } from "../contexts/GlobalState";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShareDialog } from "./ShareDialog";
import { navigateToAuth } from "@/app/hooks/useTauri";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";

interface ChatHeaderProps {
  hasMessages: boolean;
  hasActiveChat: boolean;
  chatTitle?: string | null;
  id?: string;
  chatData?:
    | {
        title?: string;
        branched_from_chat_id?: string;
        share_id?: string;
        share_date?: number;
      }
    | null
    | undefined;
  chatSidebarOpen?: boolean;
  isExistingChat?: boolean;
  isChatNotFound?: boolean;
  branchedFromChatTitle?: string;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  hasMessages,
  hasActiveChat,
  chatTitle,
  id,
  chatData,
  chatSidebarOpen = false,
  isExistingChat = false,
  isChatNotFound = false,
  branchedFromChatTitle,
}) => {
  const { user, loading } = useAuth();
  const {
    toggleChatSidebar,
    initializeNewChat,
    closeSidebar,
    setChatSidebarOpen,
    temporaryChatsEnabled,
    setTemporaryChatsEnabled,
  } = useGlobalState();
  const router = useRouter();
  const { goHome } = useChatNavigation();
  const isMobile = useIsMobile();
  const [showShareDialog, setShowShareDialog] = useState(false);

  // Show sidebar toggle for logged-in users
  const showSidebarToggle = user && !loading;

  // Check if we're currently in a chat (use isExistingChat prop for accurate state)
  const isInChat = isExistingChat;

  // Check if this is a branched chat
  const isBranchedChat = !!chatData?.branched_from_chat_id;

  const handleNewChat = () => {
    // Close computer sidebar when creating new chat
    closeSidebar();

    // Close chat sidebar when creating new chat on mobile screens
    if (isMobile) {
      setChatSidebarOpen(false);
    }

    // Reset chat state while current Chat is still mounted (so chatResetRef is set)
    initializeNewChat();
    setTemporaryChatsEnabled(false);
    goHome();
  };

  // Show empty state header when no messages and no active chat
  if (!hasMessages && !hasActiveChat) {
    return (
      <div className="flex-shrink-0">
        <header className="w-full px-6 max-sm:px-4 flex-shrink-0">
          {/* Desktop header */}
          <div className="py-[10px] flex gap-10 items-center justify-between max-md:hidden">
            <div className="flex items-center gap-2">
              {/* Removed sidebar toggle for desktop - handled by collapsed sidebar logo */}
            </div>
            <div className="flex flex-1 gap-2 justify-between items-center">
              <div className="flex gap-[40px]"></div>
              <div className="flex gap-2 items-center">
                {/* Show sign in/up buttons for non-logged-in users */}
                {!loading && !user && (
                  <>
                    <Button
                      onClick={() => navigateToAuth("/login")}
                      variant="default"
                      size="default"
                      className="min-w-[74px] rounded-[10px]"
                    >
                      Sign in
                    </Button>
                    <Button
                      onClick={() => navigateToAuth("/signup")}
                      variant="outline"
                      size="default"
                      className="min-w-16 rounded-[10px]"
                    >
                      Sign up
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Mobile header */}
          <div className="py-3 flex items-center justify-between md:hidden">
            <div className="flex items-center gap-2">
              {showSidebarToggle && !chatSidebarOpen && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Toggle chat sidebar"
                  onClick={toggleChatSidebar}
                  className="h-7 w-7 mr-2"
                >
                  <PanelLeft className="size-5" />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Show sign in/up buttons for non-logged-in users */}
              {!loading && !user && (
                <>
                  <Button
                    onClick={() => navigateToAuth("/login")}
                    variant="default"
                    size="sm"
                    className="rounded-[10px]"
                  >
                    Sign in
                  </Button>
                  <Button
                    onClick={() => navigateToAuth("/signup")}
                    variant="outline"
                    size="sm"
                    className="rounded-[10px]"
                  >
                    Sign up
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>
      </div>
    );
  }

  // Show chat header when there are messages or active chat
  if (hasMessages || hasActiveChat) {
    return (
      <>
        <ShareDialog
          open={showShareDialog}
          onOpenChange={setShowShareDialog}
          chatId={id || ""}
          chatTitle={chatTitle || ""}
          existingShareId={chatData?.share_id}
          existingShareDate={chatData?.share_date}
        />
        <div className="px-4 bg-background flex-shrink-0 md:hidden">
          <div className="flex flex-row items-center justify-between pt-3 pb-1 gap-1 sticky top-0 z-10 bg-background flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {/* Only show sidebar toggle on mobile - desktop uses collapsed sidebar logo */}
              {showSidebarToggle && !chatSidebarOpen && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open sidebar"
                  onClick={toggleChatSidebar}
                  className="size-8 flex-shrink-0 md:hidden"
                >
                  <PanelLeft className="size-5" />
                </Button>
              )}
              <div className="flex flex-row items-center gap-[6px] min-w-0 text-foreground text-lg font-medium">
                <span className="whitespace-nowrap text-ellipsis overflow-hidden flex items-center gap-2">
                  {isChatNotFound ? (
                    ""
                  ) : !isExistingChat && temporaryChatsEnabled ? (
                    <>
                      Temporary Chat
                      <HatGlasses className="size-5" />
                    </>
                  ) : (
                    <>
                      {isBranchedChat && branchedFromChatTitle && (
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Split className="size-4 flex-shrink-0 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">
                                Branched from: {branchedFromChatTitle}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {chatTitle || (isExistingChat ? " " : "New Chat")}
                    </>
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Keep the share action stable while the title loads. */}
              {!temporaryChatsEnabled && (
                <button
                  type="button"
                  aria-label="Share"
                  data-testid="share-chat-button"
                  onClick={() => setShowShareDialog(true)}
                  className={`relative h-8 flex-shrink-0 rounded-md px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none ${
                    isExistingChat && id && chatTitle
                      ? ""
                      : "invisible pointer-events-none"
                  }`}
                >
                  <div className="flex w-full items-center justify-center gap-1.5">
                    <Share className="h-4 w-4 -ms-0.5" />
                    Share
                  </div>
                </button>
              )}
              {/* New Chat Button - Show on mobile when in a chat or when temporary chat is active */}
              {isMobile &&
                (isInChat || (!isExistingChat && temporaryChatsEnabled)) &&
                showSidebarToggle && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Start new chat"
                    onClick={handleNewChat}
                    className="size-8"
                  >
                    <SquarePen className="size-5" />
                  </Button>
                )}
            </div>
          </div>
        </div>
      </>
    );
  }

  return null;
};

export default ChatHeader;
