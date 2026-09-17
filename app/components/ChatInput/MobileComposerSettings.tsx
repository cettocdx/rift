"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { observeChatViewport } from "@/app/components/chat-layout/ChatViewport";
import { HomeCommandCenter } from "@/app/components/pro/HomeCommandCenter";
import { COMPOSER_PROJECT_OPEN_EVENT } from "@/lib/utils/composer-controls";
import { ChatModeSelector } from "./ChatModeSelector";
import { ApprovalModeSelector } from "./ApprovalModeSelector";
import type { ReactNode } from "react";
import styles from "./MobileComposerSettings.module.css";

/** One mobile entry point; the existing selectors still own their behavior. */
export function MobileComposerSettings({
  chatId,
  showWorkspace,
  contextIndicator,
}: {
  chatId?: string;
  showWorkspace: boolean;
  contextIndicator?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [projectRequested, setProjectRequested] = useState(false);
  // Radix mounts portal contents after the open render. Observe at attachment,
  // including the first opening, and clean up when the portal unmounts.
  const attachPanel = useCallback((node: HTMLDivElement | null) => {
    if (node) return observeChatViewport(node);
  }, []);
  useEffect(() => {
    if (!showWorkspace) return;
    const revealProject = (event: Event) => {
      event.preventDefault();
      setProjectRequested(true);
      setOpen(true);
    };
    window.addEventListener(COMPOSER_PROJECT_OPEN_EVENT, revealProject);
    return () =>
      window.removeEventListener(COMPOSER_PROJECT_OPEN_EVENT, revealProject);
  }, [showWorkspace]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setProjectRequested(false);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Chat settings"
          className={styles.trigger}
        >
          <SlidersHorizontal aria-hidden size={19} strokeWidth={1.7} />
        </button>
      </DialogTrigger>
      <DialogContent
        ref={attachPanel}
        placement="bottom"
        className={styles.panel}
        overlayClassName={styles.overlay}
        showCloseButton={false}
      >
        <div className={styles.header}>
          <DialogTitle>Chat settings</DialogTitle>
          <DialogClose
            className={styles.close}
            aria-label="Close chat settings"
          >
            <X aria-hidden size={20} />
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">
          Choose how RIFT works and where it runs. Changes apply to your next
          message.
        </DialogDescription>
        <div className={styles.row}>
          <span>Mode</span>
          <ChatModeSelector />
        </div>
        <div className={styles.row}>
          <span>Permissions</span>
          <ApprovalModeSelector />
        </div>
        {showWorkspace && (
          <div className={styles.workspace}>
            <p>Workspace</p>
            <HomeCommandCenter
              chatId={chatId}
              openProjectOnMount={projectRequested}
              showProjectLockHint
            />
          </div>
        )}
        {contextIndicator && (
          <div className={styles.row}>
            <span>Context usage</span>
            {contextIndicator}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
