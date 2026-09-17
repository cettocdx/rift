"use client";

import { groupChatsByDate } from "@/lib/utils/chat-date-groups";
import React, { useRef, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SidebarConversation } from "./SidebarConversation";
import Loading from "@/components/ui/loading";
import { SIDEBAR_SECTION_LABEL_CLASS } from "./SidebarHeader";
import { SIDEBAR_ROW_HEIGHT_PX } from "@/lib/ui/workspace-chrome";

interface SidebarHistoryProps {
  chats: any[];
  paginationStatus?:
    | "LoadingFirstPage"
    | "CanLoadMore"
    | "LoadingMore"
    | "Exhausted";
  loadMore?: (numItems: number) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * How many recent chats the rail shows before it asks.
 *
 * The list was uncapped and fed by an infinite scroll, so it grew for as long
 * as you kept scrolling and ended up owning the whole rail -- a column of
 * near-identical titles ("Merhaba", "Merhaba mesaji", "Merhaba") with the
 * navigation squeezed above it. Ten is about a screen's worth of genuinely
 * recent work; past that you are searching, not glancing, and the rest is one
 * click away.
 */
const RECENT_COLLAPSED_COUNT = 10;

const SidebarHistory: React.FC<SidebarHistoryProps> = ({
  chats,
  paginationStatus,
  loadMore,
}) => {
  const [showAllRecent, setShowAllRecent] = useState(false);
  const loaderRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const statusRef = useRef(paginationStatus);
  // Collapsed date-group labels (e.g. "Today"). Empty = all expanded.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleGroup = (label: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  // IntersectionObserver for infinite scroll – reliable vs scroll listener on ref that can be null
  useEffect(() => {
    statusRef.current = paginationStatus;
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // Nothing to prefetch while the list is capped: the extra pages would be
    // fetched and then not shown, which is how the rail used to fill itself.
    if (
      showAllRecent &&
      paginationStatus === "CanLoadMore" &&
      chats.length > 0 &&
      loadMore
    ) {
      const options: IntersectionObserverInit = {
        root: null,
        rootMargin: "50px",
        threshold: 0.1,
      };

      observerRef.current = new IntersectionObserver((entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && statusRef.current === "CanLoadMore") {
          loadMore(28);
        }
      }, options);

      const currentLoader = loaderRef.current;
      if (currentLoader) {
        observerRef.current.observe(currentLoader);
      }
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [paginationStatus, loadMore, chats.length, showAllRecent]);

  if (paginationStatus === "LoadingFirstPage") {
    // Loading state
    return (
      <div className="px-1.5 py-2" aria-label="Loading recent chats">
        <div className="space-y-1">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse px-2 py-1">
              <div className="h-2.5 w-3/4 rounded-[3px] bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!chats || chats.length === 0) {
    // Empty state
    return (
      <div
        className="flex h-full flex-col px-3 py-3"
        data-testid="sidebar-chat-empty"
      >
        <p className="text-ui leading-5 text-muted-foreground">
          No ungrouped chats
        </p>
        {paginationStatus === "CanLoadMore" ? (
          <button
            type="button"
            className="mt-2 text-left text-ui-label hover:text-foreground"
            onClick={() => loadMore?.(28)}
          >
            Load older chats
          </button>
        ) : null}
      </div>
    );
  }

  const visibleChats = showAllRecent
    ? chats
    : chats.slice(0, RECENT_COLLAPSED_COUNT);
  const hiddenCount = chats.length - visibleChats.length;

  return (
    <div
      /* The workspace stylesheet keeps nested and standalone insets aligned. */
      className="pro-sidebar-history px-1.5 py-1"
      data-testid="sidebar-chat-list"
    >
      {groupChatsByDate(visibleChats).map((group) => {
        const open = !collapsedGroups.has(group.label);
        return (
          <section key={group.label} aria-label={group.label}>
            <button
              type="button"
              onClick={() => toggleGroup(group.label)}
              aria-expanded={open}
              className={`flex h-8 w-full items-center justify-between rounded-[6px] px-1.5 ${SIDEBAR_SECTION_LABEL_CLASS} hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent`}
            >
              {group.label}
              <ChevronDown
                className={`size-[11px] transition-transform ${open ? "" : "-rotate-90"}`}
                strokeWidth={1.75}
              />
            </button>
            {open && (
              <div className="space-y-px">
                {group.chats.map((chat: any) => (
                  <div
                    key={chat._id}
                    style={{
                      contentVisibility: "auto",
                      containIntrinsicSize: `${SIDEBAR_ROW_HEIGHT_PX}px`,
                    }}
                  >
                    <SidebarConversation chat={chat} />
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {!showAllRecent &&
        (hiddenCount > 0 || paginationStatus === "CanLoadMore") && (
          <button
            type="button"
            data-testid="sidebar-show-all-recent"
            onClick={() => setShowAllRecent(true)}
            className="flex h-[30px] w-full items-center rounded-[6px] px-1.5 text-ui-nav font-[418] leading-[18px] tracking-[-0.08px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
          >
            Show more
          </button>
        )}

      {/* Loading indicator when loading more */}
      {paginationStatus === "LoadingMore" && (
        <div className="flex justify-center py-1.5" aria-label="Loading chats">
          <Loading size={5} />
        </div>
      )}

      {/* Sentinel for IntersectionObserver – load more when scrolled into view */}
      {paginationStatus === "CanLoadMore" && chats.length > 0 && (
        <div
          ref={loaderRef}
          data-testid="sidebar-load-more-sentinel"
          className="h-px w-full"
          aria-hidden
        />
      )}
    </div>
  );
};

export default SidebarHistory;
