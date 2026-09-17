import { useEffect, useCallback, useRef } from "react";
import { useGlobalState } from "../contexts/GlobalState";
import { usePublishLiveSidebarContent } from "../contexts/LiveSidebarContent";
import type { SidebarContent } from "@/types/chat";

const SIDEBAR_UPDATE_INTERVAL_MS = 50;

interface UseToolSidebarOptions {
  /** The toolCallId for this tool invocation */
  toolCallId: string;
  /**
   * The sidebar content to display. Return null if not yet ready to show.
   * IMPORTANT: Must be memoized with useMemo to prevent unnecessary updates.
   */
  content: SidebarContent | null;
  /** Type guard to check if current sidebar content matches this tool type */
  typeGuard: (content: SidebarContent) => boolean;
  /** Set to true to disable sidebar functionality entirely (e.g., open_url tool) */
  disabled?: boolean;
}

interface UseToolSidebarResult {
  /** Open this tool's content in the sidebar */
  handleOpenInSidebar: () => void;
  /** Keyboard handler (Enter/Space) to open sidebar */
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Whether the sidebar is currently showing this tool's content */
  isSidebarActive: boolean;
}

/**
 * Reusable hook for tool sidebar integration. Handles:
 * - Opening sidebar with tool content on click/keyboard
 * - Detecting if sidebar is currently showing this tool
 * - Auto-updating sidebar content in real-time when active
 */
export function useToolSidebar({
  toolCallId,
  content,
  typeGuard,
  disabled = false,
}: UseToolSidebarOptions): UseToolSidebarResult {
  const { openSidebar, closeSidebar, sidebarOpen, sidebarContent } =
    useGlobalState();
  const publishLiveSidebarContent = usePublishLiveSidebarContent();
  const pendingContentRef = useRef<SidebarContent | null>(null);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdateAtRef = useRef(0);
  const activeRef = useRef(false);
  const publishLiveSidebarContentRef = useRef(publishLiveSidebarContent);

  const isSidebarActive =
    !disabled &&
    sidebarOpen &&
    sidebarContent != null &&
    typeGuard(sidebarContent) &&
    "toolCallId" in sidebarContent &&
    (sidebarContent as { toolCallId?: string }).toolCallId === toolCallId;

  useEffect(() => {
    activeRef.current = isSidebarActive;
    publishLiveSidebarContentRef.current = publishLiveSidebarContent;
  }, [isSidebarActive, publishLiveSidebarContent]);

  const handleOpenInSidebar = useCallback(() => {
    if (disabled || !content) return;
    publishLiveSidebarContent(content);
    openSidebar(content);
  }, [disabled, content, openSidebar, publishLiveSidebarContent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleOpenInSidebar();
        return;
      }

      if (e.key === "Escape" && isSidebarActive) {
        e.preventDefault();
        closeSidebar();
      }
    },
    [closeSidebar, handleOpenInSidebar, isSidebarActive],
  );

  // Auto-update sidebar content in real-time when active
  useEffect(() => {
    if (!isSidebarActive || !content) return;
    pendingContentRef.current = content;
    if (updateTimerRef.current !== null) return;

    const elapsed = Date.now() - lastUpdateAtRef.current;
    updateTimerRef.current = setTimeout(
      () => {
        updateTimerRef.current = null;
        const pendingContent = pendingContentRef.current;
        if (!activeRef.current || !pendingContent) return;
        lastUpdateAtRef.current = Date.now();
        publishLiveSidebarContentRef.current(pendingContent);
      },
      Math.max(0, SIDEBAR_UPDATE_INTERVAL_MS - elapsed),
    );
  }, [isSidebarActive, content]);

  useEffect(
    () => () => {
      if (updateTimerRef.current !== null) {
        clearTimeout(updateTimerRef.current);
      }
    },
    [],
  );

  return { handleOpenInSidebar, handleKeyDown, isSidebarActive };
}
