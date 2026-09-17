"use client";

import type { ChatMode, SelectedModel } from "@/types/chat";

interface ModelSelectorProps {
  value: SelectedModel;
  onChange: (model: SelectedModel) => void;
  mode: ChatMode;
}

// Single-model product: there is no tier/model choice and no badge in the chat
// toolbar. Renders nothing. Props are kept so existing call sites
// (ChatInputToolbar) don't change.
export function ModelSelector(_props: ModelSelectorProps) {
  return null;
}
