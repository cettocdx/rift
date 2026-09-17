"use client";

import {
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { generateId, type ChatInit, type DataUIPart } from "ai";
import { useRetainedChatRegistry } from "@/app/contexts/RetainedChatContext";
import { RetainedChatRegistry } from "@/lib/chat/retained-chat";
import type { HackDispatchState } from "@/lib/chat/hack-dispatch-state";
import type { ChatMessage } from "@/types/chat";

type RetainedChatOptions = ChatInit<ChatMessage> & {
  experimental_throttle?: number;
};

/** Synchronous first-window hint; reading it never creates or subscribes to a session. */
export function useRetainedChatMessageCount(chatId: string): number {
  const registry = useRetainedChatRegistry();
  return useMemo(
    () => registry?.getMessageCount(chatId) ?? 0,
    [registry, chatId],
  );
}

export type RetainedChatHelpers = UseChatHelpers<ChatMessage> & {
  /** True even on a new session when an authenticated shell owns its lifetime. */
  retentionEnabled: boolean;
  hackDispatch: HackDispatchState;
  retainedSession: boolean;
  /** Presentation snapshot at attachment; never contains replayable commands. */
  retainedDataStream: DataUIPart<any>[];
  registerResumeAbort: (abort: () => void) => () => void;
  abortRetainedResume: () => void;
  getRetainedMessages: () => ChatMessage[];
  registerRequestContext: (body: Record<string, unknown>) => void;
  stopRetainedReader: () => Promise<void>;
  retainedContinuationPending: boolean;
};

/** Reattach the UI to its original SDK state and reader after route navigation. */
export function useRetainedChat(
  options: RetainedChatOptions,
): RetainedChatHelpers {
  const shared = useRetainedChatRegistry();
  const [local] = useState(() => new RetainedChatRegistry(false));
  const [generatedId] = useState(() => options.generateId?.() ?? generateId());
  const registry = shared ?? local;
  const id = options.id ?? generatedId;
  const { session, retained } = useMemo(
    () => registry.acquire({ ...options, id }),
    // Initial options seed only a new SDK instance. Committed callbacks and
    // the next request's transport are updated independently below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, id],
  );
  const owner = useMemo(() => Symbol(session.chat.id), [session]);
  const retainedDataStream = useMemo(
    () => session.getRetainedDataStream(),
    [session],
  );

  useLayoutEffect(() => {
    if (shared) return;
    local.connect();
    return () => local.disconnect();
  }, [shared, local]);
  useLayoutEffect(() => {
    session.attach(owner, options);
    return () => session.detach(owner);
    // Updates occur in the following layout effect without detaching the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, owner]);
  useLayoutEffect(() => session.update(owner, options));

  const chat = useChat<ChatMessage>({
    chat: session.chat,
    experimental_throttle: options.experimental_throttle,
  });
  const retainedContinuationPending = useSyncExternalStore(
    session.subscribeToContinuation,
    session.getContinuationPending,
    session.getContinuationPending,
  );
  return {
    ...chat,
    hackDispatch: session.hackDispatch,
    setMessages: session.setMessages,
    sendMessage: session.sendMessage,
    regenerate: session.regenerate,
    stop: session.stop,
    stopRetainedReader: session.stopRetainedReader,
    resumeStream: session.resumeStream,
    retentionEnabled: shared !== null,
    retainedSession: retained,
    retainedDataStream,
    registerResumeAbort: session.registerResumeAbort,
    abortRetainedResume: session.abortRetainedResume,
    getRetainedMessages: session.getRetainedMessages,
    registerRequestContext: session.registerRequestContext,
    retainedContinuationPending,
  };
}
