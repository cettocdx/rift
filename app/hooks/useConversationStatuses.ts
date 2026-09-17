"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { conversationStatus } from "@/lib/ui/conversation-status";
import {
  CONVERSATION_DRAFTS_STORAGE_KEY,
  type ConversationDraftStore,
} from "@/lib/utils/client-storage";

const subscribe = (listener: () => void) => {
  window.addEventListener("rift:drafts-changed", listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("rift:drafts-changed", listener);
    window.removeEventListener("storage", listener);
  };
};
const snapshot = () => {
  try {
    return localStorage.getItem(CONVERSATION_DRAFTS_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};
export function useConversationStatuses<
  T extends {
    id: string;
    active_stream_id?: string;
    active_trigger_run_id?: string;
  },
>(chats: T[]) {
  const runs = useQuery(api.runs.listRuns, { limit: 60 });
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return useMemo(() => {
    let drafts = new Set<string>();
    try {
      const store = JSON.parse(raw) as ConversationDraftStore;
      drafts = new Set(
        store.drafts
          .filter(
            (draft) =>
              typeof draft.content === "string" && draft.content.trim(),
          )
          .map((draft) => draft.id),
      );
    } catch {}
    const latest = new Map<string, NonNullable<typeof runs>[number]>();
    const byId = new Map<string, NonNullable<typeof runs>[number]>();
    for (const run of runs ?? []) {
      byId.set(run.id, run);
      if (
        !latest.has(run.chat_id) ||
        latest.get(run.chat_id)!.started_at < run.started_at
      )
        latest.set(run.chat_id, run);
    }
    return chats.map((chat) => ({
      ...chat,
      sidebarStatus: conversationStatus(
        chat,
        chat.active_trigger_run_id
          ? byId.get(chat.active_trigger_run_id)
          : latest.get(chat.id),
        drafts.has(chat.id),
        now,
      ),
    }));
  }, [chats, runs, raw, now]);
}
