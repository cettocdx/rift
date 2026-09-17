"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SharedMessages } from "./SharedMessages";
import { Loader2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { SharedChatProvider, useSharedChatContext } from "./SharedChatContext";
import { ComputerSidebarBase } from "@/app/components/ComputerSidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/app/hooks/useAuth";
import Header from "@/app/components/Header";
import ChatHeader from "@/app/components/ChatHeader";
import MainSidebar from "@/app/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useInputValue } from "@/app/contexts/InputContext";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatInput } from "@/app/components/ChatInput";
import { upsertDraft } from "@/lib/utils/client-storage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Desktop wrapper component that connects ComputerSidebarBase to SharedChatContext
function SharedComputerSidebarDesktop({ messages }: { messages: any[] }) {
  const { sidebarOpen, sidebarContent, closeSidebar, openSidebar } =
    useSharedChatContext();

  return (
    <div
      className={`transition-all duration-300 min-w-0 ${
        sidebarOpen ? "w-1/2 flex-shrink-0" : "w-0 overflow-hidden"
      }`}
    >
      {sidebarOpen && (
        <ComputerSidebarBase
          sidebarOpen={sidebarOpen}
          sidebarContent={sidebarContent}
          closeSidebar={closeSidebar}
          messages={messages}
          onNavigate={openSidebar}
        />
      )}
    </div>
  );
}

// Mobile wrapper component for full-screen sidebar overlay
function SharedComputerSidebarMobile({ messages }: { messages: any[] }) {
  const { sidebarOpen, sidebarContent, closeSidebar, openSidebar } =
    useSharedChatContext();

  return (
    <Dialog
      open={sidebarOpen}
      onOpenChange={(open) => {
        if (!open) closeSidebar();
      }}
    >
      <DialogContent
        aria-modal="true"
        showCloseButton={false}
        className="!inset-0 flex h-[100dvh] w-full !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 rounded-none border-0 bg-background p-4"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Shared chat details</DialogTitle>
          <DialogDescription>
            Inspect files, tool output, and agent activity from this shared
            chat.
          </DialogDescription>
        </DialogHeader>
        <div className="h-full w-full">
          <ComputerSidebarBase
            sidebarOpen={sidebarOpen}
            sidebarContent={sidebarContent}
            closeSidebar={closeSidebar}
            messages={messages}
            onNavigate={openSidebar}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SharedChatErrorState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-12 text-foreground">
      <section
        aria-labelledby="shared-chat-error-title"
        className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card/40 p-6 text-center"
      >
        <AlertCircle
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground"
        />
        <div>
          <h1 id="shared-chat-error-title" className="text-xl font-semibold">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none"
          >
            Open RIFT
          </Link>
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none"
          >
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}

interface SharedChatViewProps {
  shareId: string;
}

// UUID format validation regex (matches v4 and other UUID versions)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function SharedChatView({ shareId }: SharedChatViewProps) {
  const isMobile = useIsMobile();
  const { user, loading: authLoading } = useAuth();
  const { chatSidebarOpen, setChatSidebarOpen } = useGlobalState();
  const input = useInputValue();
  const router = useRouter();
  const forkSharedChatMutation = useMutation(api.sharedChats.forkSharedChat);
  const [isForking, setIsForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);

  // Validate shareId format before making database query
  const isValidUUID = UUID_REGEX.test(shareId);

  const chat = useQuery(
    api.sharedChats.getSharedChat,
    isValidUUID ? { shareId } : "skip",
  );
  const messages = useQuery(
    api.messages.getSharedMessages,
    chat ? { chatId: chat.id } : "skip",
  );

  // Update page title when chat loads
  useEffect(() => {
    if (chat?.title) {
      document.title = `${chat.title} | RIFT`;
    }

    return () => {
      document.title = "Shared Chat | RIFT";
    };
  }, [chat?.title]);

  const handleContinueChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isForking) return;
    setForkError(null);
    setIsForking(true);
    try {
      const newChatId = await forkSharedChatMutation({ shareId });
      // Save the user's typed input as a draft for the new chat
      // so it appears in the textarea when they land on the new chat page
      if (input.trim()) {
        upsertDraft(newChatId, input);
        // Signal the chat page to auto-send the draft message
        sessionStorage.setItem("autoSendChatId", newChatId);
      }
      router.push(`/c/${newChatId}`);
    } catch {
      const message =
        "RIFT could not create an editable copy. Check your connection and try again.";
      setForkError(message);
      toast.error("Could not continue this chat", {
        description: message,
      });
      setIsForking(false);
    }
  };

  // Invalid UUID format - show not found immediately
  if (!isValidUUID) {
    return (
      <SharedChatErrorState
        title="Invalid share link"
        description="This link is malformed. Ask the sender for a new link or return to RIFT."
      />
    );
  }

  // Loading state
  if (chat === undefined) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div role="status" className="flex flex-col items-center gap-4">
          <Loader2
            aria-hidden="true"
            className="h-8 w-8 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
          <p className="text-sm text-muted-foreground">
            Loading shared chat...
          </p>
        </div>
      </main>
    );
  }

  // Chat not found or not shared
  if (chat === null) {
    return (
      <SharedChatErrorState
        title="Chat not found"
        description="This chat does not exist or is no longer shared. Ask the owner for a current link or return to RIFT."
      />
    );
  }

  return (
    <SharedChatProvider>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
        {/* Header for unlogged users */}
        {!authLoading && !user && (
          <div className="flex-shrink-0">
            <Header chatTitle={chat.title} />
          </div>
        )}

        <div className="flex w-full h-full overflow-hidden">
          {/* Chat Sidebar - Desktop screens for logged users */}
          {!isMobile && !authLoading && user && (
            <div
              className={`transition-all duration-300 ${
                chatSidebarOpen ? "w-72 flex-shrink-0" : "w-12 flex-shrink-0"
              }`}
            >
              <SidebarProvider
                open={chatSidebarOpen}
                onOpenChange={setChatSidebarOpen}
                defaultOpen={false}
              >
                <MainSidebar />
              </SidebarProvider>
            </div>
          )}

          {/* Main Content Area - matches normal chat structure */}
          <main className="relative flex min-w-0 flex-1 overflow-hidden">
            {/* Left side - Chat content */}
            <div className="flex flex-col flex-1 min-w-0 h-full">
              {/* ChatHeader for logged users - always show title */}
              {(authLoading || user) && (
                <ChatHeader
                  hasMessages={true}
                  hasActiveChat={true}
                  chatTitle={chat.title}
                  isExistingChat={true}
                  isChatNotFound={false}
                  chatSidebarOpen={chatSidebarOpen}
                />
              )}

              {/* Messages area - scrollable */}
              <div className="bg-background flex flex-col flex-1 relative min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="mx-auto w-full max-w-full sm:max-w-[768px] sm:min-w-[390px] flex flex-col space-y-4 pb-20">
                    {messages === undefined ? (
                      <div role="status" className="flex justify-center py-8">
                        <Loader2
                          aria-hidden="true"
                          className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none"
                        />
                        <span className="sr-only">Loading messages</span>
                      </div>
                    ) : (
                      <SharedMessages
                        messages={messages}
                        shareDate={chat.share_date}
                      />
                    )}
                  </div>
                </div>

                {/* Chat input for logged-in users to continue the conversation */}
                {!authLoading && user && messages && messages.length > 0 && (
                  <div>
                    <fieldset
                      disabled={isForking}
                      aria-busy={isForking}
                      className="m-0 min-w-0 border-0 p-0"
                    >
                      <legend className="sr-only">
                        Continue this shared chat
                      </legend>
                      <ChatInput
                        onSubmit={handleContinueChat}
                        onStop={() => {}}
                        onSendNow={() => {}}
                        status="ready"
                        hideStop
                        hasMessages={true}
                        isNewChat={false}
                        clearDraftOnSubmit={false}
                      />
                    </fieldset>
                    {isForking && (
                      <p
                        role="status"
                        className="px-4 pb-2 text-center text-xs text-muted-foreground"
                      >
                        Creating your editable copy of this chat...
                      </p>
                    )}
                    {forkError && (
                      <p
                        role="alert"
                        className="px-4 pb-2 text-center text-xs text-destructive"
                      >
                        {forkError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Desktop Computer Sidebar - fixed, independent scrolling */}
            {!isMobile && (
              <SharedComputerSidebarDesktop messages={messages || []} />
            )}
          </main>
        </div>

        {/* Mobile Computer Sidebar */}
        {isMobile && <SharedComputerSidebarMobile messages={messages || []} />}

        {/* Overlay Chat Sidebar - Mobile screens for logged users */}
        {isMobile && !authLoading && user && (
          <Dialog open={chatSidebarOpen} onOpenChange={setChatSidebarOpen}>
            <DialogContent
              aria-modal="true"
              showCloseButton={false}
              className="!bottom-0 !left-0 !right-auto !top-0 h-[100dvh] w-full max-w-80 !translate-x-0 !translate-y-0 gap-0 rounded-none border-y-0 border-l-0 border-r border-sidebar-border bg-sidebar p-0 shadow-2xl sm:max-w-80"
            >
              <DialogHeader className="sr-only">
                <DialogTitle>Chat navigation</DialogTitle>
                <DialogDescription>
                  Navigate RIFT chats and workspaces.
                </DialogDescription>
              </DialogHeader>
              <SidebarProvider
                open={chatSidebarOpen}
                onOpenChange={setChatSidebarOpen}
                defaultOpen={false}
              >
                <MainSidebar isMobileOverlay />
              </SidebarProvider>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </SharedChatProvider>
  );
}
