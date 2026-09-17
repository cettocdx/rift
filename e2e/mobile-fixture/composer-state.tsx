import { createContext, useContext, useState, type ReactNode } from "react";
import type {
  ChatMode,
  ReasoningEffort,
  SelectedModel,
} from "../../types/chat";

function useFixtureState() {
  const [selectedModel, setSelectedModel] =
    useState<SelectedModel>("build-fable");
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("high");
  const [chatMode, setChatMode] = useState<ChatMode>("agent");
  return {
    selectedModel,
    setSelectedModel,
    reasoningEffort,
    setReasoningEffort,
    chatMode,
    setChatMode,
    chatPurpose: "app" as const,
    temporaryChatsEnabled: false,
    subscription: "pro" as const,
    hasPaidContext: true,
  };
}
const State = createContext<ReturnType<typeof useFixtureState> | null>(null);
export function ComposerState({ children }: { children: ReactNode }) {
  return <State value={useFixtureState()}>{children}</State>;
}
export function useGlobalState() {
  const state = useContext(State);
  if (!state) throw Error("Composer fixture provider missing");
  return state;
}
