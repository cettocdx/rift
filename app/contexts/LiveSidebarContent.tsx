"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import type { SidebarContent } from "@/types/chat";

type PublishLiveSidebarContent = (content: SidebarContent | null) => void;

const LiveSidebarContentStateContext = createContext<
  SidebarContent | null | undefined
>(undefined);
const LiveSidebarContentDispatchContext =
  createContext<PublishLiveSidebarContent | null>(null);

/**
 * Isolates high-frequency terminal/tool output from GlobalState. State and
 * dispatch intentionally use separate contexts so tool rows that only publish
 * output do not rerender when another chunk arrives.
 */
export function LiveSidebarContentProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [content, setContent] = useState<SidebarContent | null>(null);
  const publish = useCallback<PublishLiveSidebarContent>((nextContent) => {
    setContent((currentContent) =>
      Object.is(currentContent, nextContent) ? currentContent : nextContent,
    );
  }, []);

  return (
    <LiveSidebarContentDispatchContext.Provider value={publish}>
      <LiveSidebarContentStateContext.Provider value={content}>
        {children}
      </LiveSidebarContentStateContext.Provider>
    </LiveSidebarContentDispatchContext.Provider>
  );
}

/** Subscribe to the latest throttled content; intended for the right pane. */
export function useLiveSidebarContent(): SidebarContent | null {
  const content = useContext(LiveSidebarContentStateContext);
  if (content === undefined) {
    throw new Error(
      "useLiveSidebarContent must be used within a LiveSidebarContentProvider",
    );
  }
  return content;
}

/** Publish live content without subscribing to content changes. */
export function usePublishLiveSidebarContent(): PublishLiveSidebarContent {
  const publish = useContext(LiveSidebarContentDispatchContext);
  if (!publish) {
    throw new Error(
      "usePublishLiveSidebarContent must be used within a LiveSidebarContentProvider",
    );
  }
  return publish;
}
