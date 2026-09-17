"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { UIMessage } from "ai";
import type { ChatStatus } from "@/types";

export interface RiftAgentConsoleSnapshot {
  chatId: string;
  messages: UIMessage[];
  status: ChatStatus;
}

export interface RiftAgentConsole {
  snapshot: RiftAgentConsoleSnapshot;
  /** True means dispatched or queued, not that generation has completed. */
  submit: (text: string) => Promise<boolean>;
  stop: () => Promise<void>;
}

interface PublishedActions {
  /** Recheck this after async preflight before dispatching to the chat. */
  submit: (text: string, isCurrent: () => boolean) => Promise<boolean>;
  stop: () => Promise<void>;
}

interface Binding {
  owner: symbol;
  snapshot: RiftAgentConsoleSnapshot;
  actions: PublishedActions;
}

function createConsoleStore(routeKey: string) {
  let active = true;
  let binding: Binding | null = null;
  let value: RiftAgentConsole | null = null;
  let submitting: symbol | null = null;
  let stopping: { owner: symbol; promise: Promise<void> } | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    routeKey,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => value,
    connect: () => {
      active = true;
    },
    disconnect: () => {
      active = false;
      binding = null;
      value = null;
      emit();
    },
    clear: (owner: symbol) => {
      if (binding?.owner !== owner) return;
      binding = null;
      value = null;
      emit();
    },
    publish: (
      owner: symbol,
      snapshot: RiftAgentConsoleSnapshot,
      actions: PublishedActions,
    ) => {
      const previous = binding;
      binding = { owner, snapshot, actions };
      if (
        previous?.owner === owner &&
        previous.snapshot.chatId === snapshot.chatId &&
        previous.snapshot.messages === snapshot.messages &&
        previous.snapshot.status === snapshot.status
      ) {
        return;
      }

      const isCurrent = () =>
        active &&
        binding?.owner === owner &&
        binding.snapshot.chatId === snapshot.chatId;
      value = {
        snapshot,
        async submit(text) {
          if (!text.trim() || !isCurrent() || submitting === owner) {
            return false;
          }
          submitting = owner;
          try {
            return (await binding!.actions.submit(text, isCurrent)) === true;
          } catch {
            return false;
          } finally {
            if (submitting === owner) submitting = null;
          }
        },
        async stop() {
          if (!isCurrent()) return;
          if (stopping?.owner === owner) return stopping.promise;
          const pending = Promise.resolve().then(() => {
            if (isCurrent()) return binding!.actions.stop();
          });
          stopping = { owner, promise: pending };
          try {
            await pending;
          } finally {
            if (stopping?.promise === pending) stopping = null;
          }
        },
      };
      emit();
    },
  };
}

const ConsoleContext = createContext<ReturnType<
  typeof createConsoleStore
> | null>(null);
const unavailable = () => null;
const subscribeUnavailable = () => () => {};

/** One bridge for the mounted route; the terminal keeps its own React tree. */
export function RiftAgentConsoleProvider({
  children,
  routeKey,
}: {
  children: ReactNode;
  routeKey: string;
}) {
  const store = useMemo(() => createConsoleStore(routeKey), [routeKey]);
  useLayoutEffect(() => {
    store.connect();
    return store.disconnect;
  }, [store]);
  return (
    <ConsoleContext.Provider value={store}>{children}</ConsoleContext.Provider>
  );
}

/** Consumers outside a live chat receive null, never a synthetic conversation. */
export function useOptionalRiftAgentConsole(): RiftAgentConsole | null {
  const store = useContext(ConsoleContext);
  return useSyncExternalStore(
    store?.subscribe ?? subscribeUnavailable,
    store?.getSnapshot ?? unavailable,
    unavailable,
  );
}

/** Provider presence is stable even while a route is loading its Chat. */
export function useHasRiftAgentConsoleProvider(): boolean {
  return useContext(ConsoleContext) !== null;
}

/** Publish committed chat data without subscribing the Chat tree to its mirror. */
export function usePublishRiftAgentConsole(
  snapshot: RiftAgentConsoleSnapshot | null,
  actions: PublishedActions,
) {
  const store = useContext(ConsoleContext);
  const owner = useMemo(() => Symbol(snapshot?.chatId), [snapshot?.chatId]);
  useLayoutEffect(() => () => store?.clear(owner), [store, owner]);
  useLayoutEffect(() => {
    if (snapshot) store?.publish(owner, snapshot, actions);
  }, [store, owner, snapshot, actions]);
}
