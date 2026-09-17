"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ChatPurpose } from "@/types/chat";
import { purposeChatPath } from "@/lib/navigation/chat-routes";
export {
  isPurposeChatActive,
  purposeChatPath,
  chatIdFromPathname,
} from "@/lib/navigation/chat-routes";
import {
  proChatRoute,
  useProShell,
} from "@/app/components/pro/ProShellContext";
import { useGlobalState } from "@/app/contexts/GlobalState";

export function chatPathFor(
  basePath: string,
  enabled: boolean,
  chatId: string,
) {
  return enabled ? proChatRoute(basePath, chatId) : `/c/${chatId}`;
}

/**
 * Read the active conversation id from every first-party chat surface. This
 * lets users move the same run between Build, Studio and CLI Workspace instead
 * of silently starting a blank workspace when the current route has a prefix.
 */
export function useChatNavigation() {
  const { enabled, basePath } = useProShell();
  const { chatPurpose, setBuildPreviewOpen, setBuildPreviewUrl } =
    useGlobalState();
  const router = useRouter();
  const home = enabled ? proChatRoute(basePath) : "/";

  const clearBuildPreview = useCallback(() => {
    setBuildPreviewOpen(false);
    setBuildPreviewUrl(null);
  }, [setBuildPreviewOpen, setBuildPreviewUrl]);

  const chatPath = useCallback(
    (chatId: string) => chatPathFor(basePath, enabled, chatId),
    [basePath, enabled],
  );

  const chatRoute = useCallback(
    (chatId?: string | null) =>
      enabled ? proChatRoute(basePath, chatId) : chatId ? `/c/${chatId}` : "/",
    [basePath, enabled],
  );

  const isActiveChat = useCallback(
    (chatId: string, pathname: string) => pathname === chatPath(chatId),
    [chatPath],
  );

  const replaceChatUrl = useCallback(
    (chatId: string) => {
      // Changing an App Router segment with the native History API updates the
      // visible pathname without supplying the new `[id]` route param. The
      // mounted root Chat then resets itself as a fresh conversation. Use the
      // router so the durable chat page and its Convex query are loaded after
      // a completed new-chat response.
      const durablePath = enabled
        ? chatPath(chatId)
        : purposeChatPath(chatPurpose, chatId);
      router.replace(durablePath, { scroll: false });
    },
    [chatPath, chatPurpose, enabled, router],
  );

  const goPurpose = useCallback(
    (purpose: ChatPurpose, chatId?: string | null) => {
      clearBuildPreview();
      router.push(purposeChatPath(purpose, chatId));
    },
    [clearBuildPreview, router],
  );

  const goHome = useCallback(() => {
    clearBuildPreview();
    router.push(home);
  }, [clearBuildPreview, home, router]);

  const goChat = useCallback(
    (chatId: string) => {
      clearBuildPreview();
      router.push(chatPath(chatId));
    },
    [chatPath, clearBuildPreview, router],
  );

  return {
    basePath: home,
    enabled,
    chatPath,
    chatRoute,
    isActiveChat,
    replaceChatUrl,
    goPurpose,
    goHome,
    goChat,
  };
}
