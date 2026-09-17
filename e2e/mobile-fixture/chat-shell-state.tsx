import { createContext, useContext, useState, type ReactNode } from "react";
import { useGlobalState as useComposerState } from "./composer-state";
import { ComposerState as BaseComposerState } from "./composer-state";

const NavigationState = createContext<{
  chatSidebarOpen: boolean;
  setChatSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
} | null>(null);

export function ComposerState({ children }: { children: ReactNode }) {
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  return (
    <BaseComposerState>
      <NavigationState value={{ chatSidebarOpen, setChatSidebarOpen }}>
        {children}
      </NavigationState>
    </BaseComposerState>
  );
}

export function useGlobalState() {
  const state = useComposerState();
  const navigation = useContext(NavigationState);
  if (!navigation) throw Error("Chat shell navigation provider missing");
  const { chatSidebarOpen, setChatSidebarOpen } = navigation;
  return {
    ...state,
    todos: [],
    isTodoPanelExpanded: false,
    setIsTodoPanelExpanded: () => {},
    chatSidebarOpen,
    setChatSidebarOpen,
    closeSidebar: () => setChatSidebarOpen(false),
    toggleChatSidebar: () => setChatSidebarOpen((open) => !open),
    isSubscriptionReady: true,
    isCheckingProPlan: false,
    initializeNewChat: () => {},
    setTemporaryChatsEnabled: () => {},
  };
}
