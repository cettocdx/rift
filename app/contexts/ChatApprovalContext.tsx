"use client";

import { createContext, useContext } from "react";

export const ChatApprovalContext = createContext<{
  toolCallIds: readonly string[];
  onReview?: () => void;
}>({ toolCallIds: [] });

export function useChatApprovals() {
  return useContext(ChatApprovalContext);
}
