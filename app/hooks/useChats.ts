"use client";

import { usePaginatedQuery, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Wrapper around usePaginatedQuery for user chats.
 * Auth is enforced server-side by Convex.
 */
export const useChats = (shouldFetch = true) =>
  usePaginatedQuery(api.chats.getUserChats, shouldFetch ? {} : "skip", {
    initialNumItems: 28,
  });

export const usePinChat = () => useMutation(api.chats.pinChat);
export const useUnpinChat = () => useMutation(api.chats.unpinChat);

/** Search the full server-side title index, not only loaded sidebar pages. */
export const useChatTitleSearch = (
  search: string,
  shouldFetch: boolean = true,
) => {
  const query = search.trim();
  return useQuery(
    api.chats.searchUserChats,
    shouldFetch && query ? { query, limit: 60 } : "skip",
  );
};
