"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import type { QueuedMessage } from "@/types/chat";
import type { FileMessagePart } from "@/types/file";

const EMPTY_QUEUE: QueuedMessage[] = [];
const MAX_QUEUE_LENGTH = 10;

export type QueueAcceptance =
  | { accepted: true; id: string }
  | { accepted: false; reason: "full" | "unbound" | "stale-owner" };

type QueueCache = {
  ownerId: string | null;
  generation: number;
  activeChatId: string | null;
  conversations: Map<string, QueuedMessage[]>;
};

/**
 * Queued follow-ups belong to a conversation, not the currently mounted page.
 * Undefined owner means auth is resolving; null means signed out.
 */
export function useConversationQueue(ownerId: string | null | undefined) {
  const [cache, setCache] = useState<QueueCache>(() => ({
    ownerId: ownerId ?? null,
    generation: 0,
    activeChatId: null,
    conversations: new Map(),
  }));
  // Event handlers share an immediate snapshot: React may batch renders, but
  // acceptance must describe the insertion already committed to this cache.
  const cacheRef = useRef(cache);
  // Retain drafts during auth refresh, but never authorize new side effects
  // until the authenticated owner is resolved again. Retained callbacks must
  // observe the latest committed auth state too.
  const dispatchOwnerRef = useRef(ownerId);
  useLayoutEffect(() => {
    dispatchOwnerRef.current = ownerId;
  }, [ownerId]);
  const committedOwner = cache.ownerId;
  const committedGeneration = cache.generation;
  const updateCache = useCallback(
    (update: (previous: QueueCache) => QueueCache) => {
      // A child can bind its chat in a layout effect before this hook's
      // layout effect. Initialize only a newer account generation here;
      // an old callback can never replace a newer generation.
      if (cacheRef.current.generation < committedGeneration) {
        cacheRef.current = {
          ownerId: committedOwner,
          generation: committedGeneration,
          activeChatId: null,
          conversations: new Map(),
        };
      }
      const previous = cacheRef.current;
      const next = update(previous);
      if (next === previous) return;
      cacheRef.current = next;
      setCache(next);
    },
    [committedOwner, committedGeneration],
  );
  // Reset before consumers commit an account change. Waiting for an effect
  // would leave the prior account's queue visible for one render.
  if (ownerId !== undefined && cache.ownerId !== ownerId) {
    const next: QueueCache = {
      ownerId,
      generation: cache.generation + 1,
      activeChatId: null,
      conversations: new Map(),
    };
    setCache(next);
  }
  useLayoutEffect(() => {
    // Retire callbacks from the previous owner before post-commit events or
    // the conversation binding effect can enqueue into the new account.
    if (cacheRef.current.generation !== cache.generation) {
      cacheRef.current = cache;
    }
  }, [cache]);
  const owner = ownerId === undefined ? cache.ownerId : ownerId;
  const generation = cache.generation;
  const ownsCache = cache.ownerId === owner;
  const activeQueueChatId = ownsCache ? cache.activeChatId : null;
  const messageQueue =
    activeQueueChatId === null
      ? EMPTY_QUEUE
      : (cache.conversations.get(activeQueueChatId) ?? EMPTY_QUEUE);

  const setActiveQueueChat = useCallback(
    (chatId: string | null) => {
      updateCache((previous) => {
        if (
          previous.ownerId !== owner ||
          previous.generation !== generation ||
          previous.activeChatId === chatId
        ) {
          return previous;
        }
        return { ...previous, activeChatId: chatId };
      });
    },
    [owner, generation, updateCache],
  );

  const queueMessage = useCallback(
    (text: string, files?: FileMessagePart[]): QueueAcceptance => {
      const previous = cacheRef.current;
      if (previous.ownerId !== owner || previous.generation !== generation) {
        return { accepted: false, reason: "stale-owner" };
      }
      if (activeQueueChatId === null)
        return { accepted: false, reason: "unbound" };
      const queue =
        previous.conversations.get(activeQueueChatId) ?? EMPTY_QUEUE;
      if (queue.length >= MAX_QUEUE_LENGTH) {
        toast.error("Queue is full", {
          description:
            "Please wait for queued messages to send before adding more.",
        });
        return { accepted: false, reason: "full" };
      }
      const message: QueuedMessage = {
        id: uuidv4(),
        text,
        files,
        timestamp: Date.now(),
      };
      const conversations = new Map(previous.conversations);
      conversations.set(activeQueueChatId, [...queue, message]);
      updateCache(() => ({ ...previous, conversations }));
      return { accepted: true, id: message.id };
    },
    [activeQueueChatId, owner, generation, updateCache],
  );

  const claimQueuedMessage = useCallback(
    (id: string) => {
      const previous = cacheRef.current;
      const chatId = activeQueueChatId;
      if (
        ownerId == null ||
        dispatchOwnerRef.current !== ownerId ||
        chatId === null ||
        previous.ownerId !== owner ||
        previous.generation !== generation
      )
        return null;
      const queue = previous.conversations.get(chatId);
      const message = queue?.find((item) => item.id === id);
      if (
        !message ||
        queue?.some((item) => item.dispatchState === "sending") ||
        queue?.some((item) => item.dispatchState === "unconfirmed")
      )
        return null;
      const token = uuidv4();
      const conversations = new Map(previous.conversations);
      conversations.set(
        chatId,
        queue!.map((item) =>
          item.id === id
            ? {
                ...item,
                dispatchState: "sending" as const,
                dispatchAttempt: token,
              }
            : item,
        ),
      );
      updateCache(() => ({ ...previous, conversations }));
      let settled = false;
      const settle = (outcome: "accepted" | "failed" | "restore") => {
        if (settled) return;
        settled = true;
        updateCache((current) => {
          if (current.ownerId !== owner || current.generation !== generation)
            return current;
          const items = current.conversations.get(chatId);
          if (
            !items?.some(
              (item) => item.id === id && item.dispatchAttempt === token,
            )
          )
            return current;
          const remaining =
            outcome === "accepted"
              ? items.filter((item) => item.id !== id)
              : items.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        dispatchAttempt: undefined,
                        dispatchState:
                          outcome === "failed"
                            ? ("unconfirmed" as const)
                            : undefined,
                      }
                    : item,
                );
          const next = new Map(current.conversations);
          if (remaining.length) next.set(chatId, remaining);
          else next.delete(chatId);
          return { ...current, conversations: next };
        });
      };
      return {
        message,
        isCurrent: () =>
          !settled &&
          dispatchOwnerRef.current === owner &&
          owner != null &&
          cacheRef.current.ownerId === owner &&
          cacheRef.current.generation === generation &&
          cacheRef.current.conversations
            .get(chatId)
            ?.some(
              (item) => item.id === id && item.dispatchAttempt === token,
            ) === true,
        accepted: () => settle("accepted"),
        failed: () => settle("failed"),
        restore: () => settle("restore"),
      };
    },
    [activeQueueChatId, owner, ownerId, generation, updateCache],
  );

  const removeQueuedMessage = useCallback(
    (id: string) => {
      if (activeQueueChatId === null) return;
      updateCache((previous) => {
        if (previous.ownerId !== owner || previous.generation !== generation) {
          return previous;
        }
        const queue = previous.conversations.get(activeQueueChatId);
        if (
          !queue?.some(
            (message) =>
              message.id === id && message.dispatchState !== "sending",
          )
        )
          return previous;
        const remaining = queue.filter((message) => message.id !== id);
        const conversations = new Map(previous.conversations);
        if (remaining.length) conversations.set(activeQueueChatId, remaining);
        else conversations.delete(activeQueueChatId);
        return { ...previous, conversations };
      });
    },
    [activeQueueChatId, owner, generation, updateCache],
  );

  const clearQueue = useCallback(() => {
    if (activeQueueChatId === null) return;
    updateCache((previous) => {
      if (
        previous.ownerId !== owner ||
        previous.generation !== generation ||
        !previous.conversations.has(activeQueueChatId)
      ) {
        return previous;
      }
      const conversations = new Map(previous.conversations);
      const sending =
        previous.conversations
          .get(activeQueueChatId)
          ?.filter((item) => item.dispatchState === "sending") ?? [];
      if (sending.length) conversations.set(activeQueueChatId, sending);
      else conversations.delete(activeQueueChatId);
      return { ...previous, conversations };
    });
  }, [activeQueueChatId, owner, generation, updateCache]);

  return {
    activeQueueChatId,
    setActiveQueueChat,
    messageQueue,
    queueMessage,
    removeQueuedMessage,
    claimQueuedMessage,
    clearQueue,
  };
}
