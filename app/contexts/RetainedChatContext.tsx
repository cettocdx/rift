"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";
import { RetainedChatRegistry } from "@/lib/chat/retained-chat";

import { useAuth } from "@/app/hooks/useAuth";

const Context = createContext<RetainedChatRegistry | null>(null);

/** Mount inside the authenticated shell. A different account receives a fresh registry. */
export function RetainedChatProvider({
  scopeKey,
  children,
}: {
  scopeKey: string;
  children: ReactNode;
}) {
  // Changing account identity must discard every retained session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const registry = useMemo(() => new RetainedChatRegistry(), [scopeKey]);
  useLayoutEffect(() => {
    registry.connect();
    return () => registry.disconnect();
  }, [registry]);
  return (
    <Context.Provider key={scopeKey} value={registry}>
      {children}
    </Context.Provider>
  );
}

export function useRetainedChatRegistry() {
  return useContext(Context);
}

export function AccountRetainedChatProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useAuth();
  return (
    <RetainedChatProvider scopeKey={user?.id ?? "signed-out"}>
      {children}
    </RetainedChatProvider>
  );
}
