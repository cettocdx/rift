"use client";
import { useEffect, useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { IndependentConsoleClient } from "@/packages/console/src/independent-client";
import type {
  ConsoleCommand,
  ConsoleSnapshot,
} from "@/packages/console/src/protocol";

// Survives dock/route unmounts, but is never shared across signed-in accounts.
const clients = new Map<string, IndependentConsoleClient>();
const unavailable: ConsoleSnapshot = {
  chatId: null,
  status: "unavailable",
  entries: [],
  model: "",
  modelLabel: "",
  effort: "medium",
  approval: "ask",
  mode: "agent",
  target: "e2b",
  targetLabel: "Cloud",
  models: [],
  efforts: [],
  targets: [],
  approvals: [],
  queued: 0,
};
const clientListeners = new Set<() => void>();
const subscribeClients = (listener: () => void) => {
  clientListeners.add(listener);
  return () => {
    clientListeners.delete(listener);
  };
};
const noClient = () => null;
const noSubscribe = () => () => {};
const noSnapshot = () => unavailable;
export function useRiftConsoleRuntime() {
  const { user, loading } = useAuth();
  const userId = user?.id;
  const getClient = useCallback(
    () => (!loading && userId ? (clients.get(userId) ?? null) : null),
    [userId, loading],
  );
  const client = useSyncExternalStore(subscribeClients, getClient, noClient);
  useEffect(() => {
    if (loading) return;
    for (const [id, other] of clients)
      if (id !== userId) {
        other.close();
        clients.delete(id);
      }
    if (!userId) {
      clientListeners.forEach((listener) => listener());
      return;
    }
    let current = clients.get(userId);
    if (!current) {
      const key = `rift:terminal:independent:session:${userId}`;
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(key);
      } catch {}
      current = new IndependentConsoleClient(
        fetch.bind(window),
        saved ?? undefined,
        (id) => {
          try {
            localStorage.setItem(key, id);
          } catch {}
        },
      );
      clients.set(userId, current);
      void current.initialize().catch(() => {
        /* Keep unavailable; no main-chat fallback. */
      });
    } else if (
      current.snapshot.status === "error" ||
      current.snapshot.status === "unavailable"
    ) {
      // Reopening the dock must recover its retained session after a failed reader.
      void current.initialize().catch(() => {
        /* The client exposes the recovery error. */
      });
    }
    clientListeners.forEach((listener) => listener());
    const retainedClient = current;
    const reconnect = () => {
      if (
        retainedClient.snapshot.status === "error" ||
        retainedClient.snapshot.status === "unavailable"
      )
        void retainedClient.initialize().catch(() => {
          /* Recovery errors stay in the console. */
        });
    };
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, [userId, loading]);
  const snapshot = useSyncExternalStore(
    client?.subscribe ?? noSubscribe,
    client?.getSnapshot ?? noSnapshot,
    noSnapshot,
  );
  return {
    snapshot,
    async onCommand(command: ConsoleCommand) {
      if (!client)
        return { accepted: false, error: "Sign in to use RIFT Terminal." };
      try {
        await client.send(command);
        return { accepted: true };
      } catch (e) {
        return {
          accepted: false,
          error: e instanceof Error ? e.message : "Task not sent.",
        };
      }
    },
  };
}
