"use client";

import React, { useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ConvexError } from "convex/values";
import { useGlobalState } from "../contexts/GlobalState";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Ellipsis,
  Trash2,
  Edit2,
  Split,
  Share,
  Pin,
  PinOff,
  CircleAlert,
  SquarePen,
  Clock3,
} from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { removeDraft } from "@/lib/utils/client-storage";
import Link from "next/link";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import { ShareDialog } from "./ShareDialog";
import { usePinChat, useUnpinChat } from "../hooks/useChats";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { RiftReasoningOrb } from "@/components/ui/rift-reasoning-orb";

import {
  CONVERSATION_STATUS_LABELS,
  type ConversationStatus,
} from "@/lib/ui/conversation-status";

interface ChatItemProps {
  id: string;
  title: string;
  isBranched?: boolean;
  branchedFromTitle?: string;
  shareId?: string;
  shareDate?: number;
  isPinned?: boolean;
  isStreaming?: boolean;
  status?: ConversationStatus;
}

const ChatItem: React.FC<ChatItemProps> = ({
  id,
  title,
  isBranched = false,
  branchedFromTitle,
  shareId,
  shareDate,
  isPinned = false,
  isStreaming = false,
  status,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const settingsHref = useSettingsNavigation().hrefFor(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [isRenaming, setIsRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    closeSidebar,
    setChatSidebarOpen,
    initializeNewChat,
    initializeChat,
  } = useGlobalState();
  const isMobile = useIsMobile();
  const deleteChat = useMutation(api.chats.deleteChat);
  const renameChat = useMutation(api.chats.renameChat);
  const pinChat = usePinChat();
  const unpinChat = useUnpinChat();
  const { isActiveChat, goChat } = useChatNavigation();

  // Check if this chat is currently active based on URL (usePathname so we re-render when route changes)
  const isCurrentlyActive = isActiveChat(id, pathname);

  const handleClick = () => {
    // Don't navigate if dialog is open or dropdown is open
    if (showRenameDialog || isDropdownOpen) {
      return;
    }

    closeSidebar();

    if (isMobile) {
      setChatSidebarOpen(false);
    }

    // Clear input and transient state only when switching to a different chat
    if (!isCurrentlyActive) {
      initializeChat(id);
    }

    // Navigate to the chat route
    goChat(id);
  };

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropdownOpen(false);

    setTimeout(() => {
      setShowDeleteDialog(true);
    }, 50);
  };

  const handleDeleteConfirm = async () => {
    if (isDeleting) return;
    setIsDeleting(true);

    try {
      await deleteChat({ chatId: id });

      // Remove draft from localStorage immediately after successful deletion
      removeDraft(id);

      // If we're deleting the currently active chat, navigate to home
      if (isCurrentlyActive) {
        initializeNewChat();
        router.push("/");
      }
    } catch (error: any) {
      // Extract error message
      const errorMessage =
        error instanceof ConvexError
          ? (error.data as { message?: string })?.message ||
            error.message ||
            "Failed to delete chat"
          : error instanceof Error
            ? error.message
            : String(error?.message || error);

      // Treat not found as success, and show other errors
      if (errorMessage.includes("Chat not found")) {
        // Even if chat not found in DB, still clean up draft
        removeDraft(id);
        if (isCurrentlyActive) {
          initializeNewChat();
          router.push("/");
        }
      } else {
        console.error("Failed to delete chat:", error);
        toast.error(errorMessage);
      }
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const handleRename = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Close dropdown first, then open dialog with a small delay to avoid focus conflicts
    setIsDropdownOpen(false);
    setEditTitle(title); // Set the current title when opening dialog

    // Small delay to ensure dropdown is fully closed before opening dialog
    setTimeout(() => {
      setShowRenameDialog(true);
    }, 50);
  };

  const handleShare = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Close dropdown first, then open share dialog
    setIsDropdownOpen(false);

    // Small delay to ensure dropdown is fully closed before opening dialog
    setTimeout(() => {
      setShowShareDialog(true);
    }, 50);
  };

  const handlePin = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropdownOpen(false);
    try {
      await pinChat({ chatId: id });
    } catch (error) {
      console.error("Failed to pin chat:", error);
      toast.error("Failed to pin chat");
    }
  };

  const handleUnpin = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropdownOpen(false);
    try {
      await unpinChat({ chatId: id });
    } catch (error) {
      console.error("Failed to unpin chat:", error);
      toast.error("Failed to unpin chat");
    }
  };

  const handleSaveRename = async () => {
    const trimmedTitle = editTitle.trim();

    // Don't save if title is empty or unchanged
    if (!trimmedTitle || trimmedTitle === title) {
      setShowRenameDialog(false);
      setEditTitle(title); // Reset to original title
      return;
    }

    try {
      setIsRenaming(true);
      await renameChat({ chatId: id, newTitle: trimmedTitle });
      setShowRenameDialog(false);
    } catch (error) {
      console.error("Failed to rename chat:", error);
      const errorMessage =
        error instanceof ConvexError
          ? (error.data as { message?: string })?.message ||
            error.message ||
            "Failed to rename chat"
          : error instanceof Error
            ? error.message
            : "Failed to rename chat";
      toast.error(errorMessage);
      setEditTitle(title); // Reset to original title on error
    } finally {
      setIsRenaming(false);
    }
  };

  const handleCancelRename = () => {
    setShowRenameDialog(false);
    setEditTitle(title); // Reset to original title
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelRename();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't handle keyboard events if dialog or dropdown is open
    if (showRenameDialog || isDropdownOpen || showDeleteDialog) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      /* Literally the same row as the navigation above it: 32px, 6px radius,
         8px of padding -- the explicit ask, and what cursor.com/agents runs
         rail-wide. A 30px row on 6px of padding was close enough to look like
         a mistake rather than a distinction: the longest list in the rail drew
         its fill two pixels shorter and its text two pixels further left than
         every row above it.
         Hover stays the lighter of the two fills; the full strength belongs to
         the row you are actually on. Matching them made every hover look like
         a selection. */
      className={`group relative flex h-[30px] w-full cursor-pointer items-center rounded-[6px] px-1.5 text-ui-nav font-[418] leading-[18px] tracking-[-0.08px] transition-colors duration-(--duration-press) ease-(--ease-out) hover:bg-sidebar-accent/60 hover:text-foreground active:bg-sidebar-accent focus:outline-none ${
        isCurrentlyActive
          ? "bg-sidebar-accent text-sidebar-foreground"
          : "text-[var(--cursor-text-secondary)]"
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={
        status ? `${title} · ${CONVERSATION_STATUS_LABELS[status]}` : title
      }
      role="button"
      tabIndex={0}
      aria-label={`Open chat: ${title}${status ? `, ${CONVERSATION_STATUS_LABELS[status]}` : ""}`}
      aria-current={isCurrentlyActive ? "page" : undefined}
      data-active={isCurrentlyActive ? "true" : "false"}
      data-testid={`chat-item-${id}`}
    >
      {/* The title truncates on its own element. It used to sit as bare text
          inside the flex row, and `text-overflow: ellipsis` does not apply to
          an anonymous flex item — which is why long titles were cut through
          the middle of a glyph with no ellipsis at all. */}
      <div className="mr-5 min-w-0 flex-1 overflow-hidden" dir="auto">
        <span className="flex items-center gap-2">
          {/* A fixed leading slot aligns titles with navigation labels, even
              when a conversation has no status glyph. */}
          <span className="flex size-4 shrink-0 items-center justify-center">
            {status && status !== "running" ? (
              <span
                title={CONVERSATION_STATUS_LABELS[status]}
                aria-label={CONVERSATION_STATUS_LABELS[status]}
                className={`shrink-0 ${status === "failed" ? "text-destructive" : status === "draft" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}
              >
                {status === "draft" ? (
                  <SquarePen aria-hidden className="size-3" />
                ) : status === "waiting" ? (
                  <Clock3 aria-hidden className="size-3" />
                ) : (
                  <CircleAlert aria-hidden className="size-3" />
                )}
              </span>
            ) : isStreaming ? (
              <span
                data-testid="chat-item-streaming-icon"
                className="inline-flex"
              >
                <RiftReasoningOrb />
              </span>
            ) : isPinned ? (
              <Pin
                className="size-3 flex-shrink-0 text-muted-foreground"
                data-testid="chat-item-pin-icon"
                strokeWidth={1.75}
              />
            ) : isBranched && branchedFromTitle ? (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Split
                      className="size-3 flex-shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="text-xs">
                      Branched from: {branchedFromTitle}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </span>
          <span className="min-w-0 truncate">{title}</span>
        </span>
      </div>

      <div
        className={`absolute right-1 opacity-0 transition-opacity duration-100 ${
          isHovered || isCurrentlyActive || isDropdownOpen || isMobile
            ? "opacity-100"
            : ""
        }`}
      >
        <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-5 rounded-[8px] p-0 hover:bg-sidebar-accent"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              aria-label="Open conversation options"
            >
              <Ellipsis className="size-[14px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={5}
            className="z-50 py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem onClick={handleRename}>
              <Edit2 className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
            {isPinned ? (
              <DropdownMenuItem onClick={handleUnpin}>
                <PinOff className="mr-2 h-4 w-4" />
                Unpin
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={handlePin}>
                <Pin className="mr-2 h-4 w-4" />
                Pin
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleShare}>
              <Share className="mr-2 h-4 w-4" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDeleteClick}
              className="text-muted-foreground focus:text-foreground"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Rename Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
            <DialogDescription>
              Enter a new name for this chat conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input
              ref={inputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={isRenaming}
              placeholder="Chat name"
              maxLength={100}
              className="w-full"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelRename}
              disabled={isRenaming}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveRename}
              disabled={isRenaming || !editTitle.trim()}
            >
              {isRenaming ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Dialog */}
      <ShareDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        chatId={id}
        chatTitle={title}
        existingShareId={shareId}
        existingShareDate={shareDate}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  This will delete <strong>{title}</strong>.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Visit{" "}
                  <Link
                    href={settingsHref}
                    className="underline hover:text-foreground"
                    onClick={() => setShowDeleteDialog(false)}
                  >
                    settings
                  </Link>{" "}
                  to delete any notes saved during this chat.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ChatItem;
