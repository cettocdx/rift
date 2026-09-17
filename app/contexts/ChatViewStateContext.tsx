"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { FileDetails } from "@/types/file";
import type {
  ChatMode,
  ChatPurpose,
  SelectedModel,
  ReasoningEffort,
  ActiveProjectContext,
} from "@/types/chat";
import type { Todo } from "@/types";
import type { ContextUsageData } from "@/app/components/ContextUsageIndicator";
import type { RateLimitWarningData } from "@/app/components/RateLimitWarning";

export type ChatScrollPosition = {
  top: number;
  atBottom: boolean;
  // Serializable, memory-only reading anchor; never retain detached DOM nodes.
  anchor?: {
    messageId: string;
    selector: string;
    index: number;
    text: string;
    offset: number;
  };
};
export type ChatViewState = {
  codePresentation?: Map<string, { source: string; wrapped: boolean }>;
  chatData?: FunctionReturnType<typeof api.chats.getChatByIdFromClient>;
  loadedMessageCount?: number;
  title?: string | null;
  files?: Map<string, FileDetails[]>;
  contextUsage?: ContextUsageData;
  rateLimitWarning?: RateLimitWarningData | null;
  scroll?: ChatScrollPosition;
  preferences?: {
    chatMode: ChatMode;
    chatPurpose: ChatPurpose;
    selectedModel: SelectedModel;
    reasoningEffort: ReasoningEffort;
    sandboxPreference: string;
    activeProject: ActiveProjectContext | null;
    todos: Todo[];
  };
};

// Memory only, owned by the authenticated shell; no transcript in localStorage.
const Context = createContext<Map<string, ChatViewState> | null>(null);
export function ChatViewStateProvider({ children }: { children: ReactNode }) {
  const [views] = useState(() => new Map<string, ChatViewState>());
  return <Context.Provider value={views}>{children}</Context.Provider>;
}

export function useChatViewState(chatId: string): ChatViewState {
  const shared = useContext(Context);
  return useMemo(() => {
    if (!shared) return {};
    const existing = shared.get(chatId);
    if (existing) {
      shared.delete(chatId);
      shared.set(chatId, existing);
      return existing;
    }
    const view: ChatViewState = {};
    shared.set(chatId, view);
    // Only lightweight UI state is retained here. Live SDK sessions have their
    // own lifetime and are never evicted by this display cache.
    if (shared.size > 40) shared.delete(shared.keys().next().value!);
    return view;
  }, [chatId, shared]);
}
