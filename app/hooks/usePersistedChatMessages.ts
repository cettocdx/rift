"use client";

import { useEffect, type RefObject } from "react";
import type { ChatMessage, ChatStatus } from "@/types/chat";

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => equal(value, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  return keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length &&
    keys.every((key) => equal(left[key], right[key]));
}

const toolStateRank: Record<string, number> = {
  "input-streaming": 0, "input-available": 1, "approval-requested": 2,
  "approval-responded": 3, "output-available": 4, "output-error": 4, "output-denied": 4,
};

function preservesProgress(current: ChatMessage, incoming: ChatMessage): boolean {
  // Transient data/step markers may be intentionally omitted by persistence.
  const visible = (parts: ChatMessage["parts"]) => parts.filter((part) =>
    part.type !== "step-start" && !part.type.startsWith("data-"));
  const next = visible(incoming.parts);
  return visible(current.parts).every((part, index) => {
    const candidate = next[index];
    if (!candidate || part.type !== candidate.type) return false;
    if ((part.type === "text" || part.type === "reasoning") &&
      (candidate.type === "text" || candidate.type === "reasoning")) {
      return candidate.text.startsWith(part.text) &&
        !(part.state === "done" && candidate.state === "streaming");
    }
    if ("toolCallId" in part && "toolCallId" in candidate) {
      if (part.toolCallId !== candidate.toolCallId) return false;
      const before = toolStateRank[part.state] ?? 0;
      const after = toolStateRank[candidate.state] ?? 0;
      // Terminal output must not be replaced by a different stale result.
      return after > before || (after === before && equal(part, candidate));
    }
    // File URLs are signed/transient and intentionally removed on persistence.
    if (part.type === "file" && candidate.type === "file") return part.filename === candidate.filename && part.mediaType === candidate.mediaType;
    return equal(part, candidate);
  });
}

/** Accept persisted progress without truncating a newer local turn or replay. */
export function reconcilePersistedMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length || incoming.length < current.length) return current;
  const ids = new Set(incoming.map((message) => message.id));
  if (current.some((message) => !ids.has(message.id))) return current;
  const existing = new Map(current.map((message) => [message.id, message]));
  const sharedOrder = incoming.filter((message) => existing.has(message.id));
  if (sharedOrder.some((message, index) => message.id !== current[index].id)) return current;

  const merged = incoming.map((message) => {
    const local = existing.get(message.id);
    if (!local) return message;
    if (local.role !== message.role || !preservesProgress(local, message)) return local;
    // Persisted feedback/timing may arrive after finish. Keep stream-only usage
    // totals when the database representation doesn't include them.
    const metadata = { ...local.metadata, ...message.metadata };
    return { ...local, ...message, metadata: Object.keys(metadata).length ? metadata : undefined };
  });
  return equal(current, merged) ? current : merged;
}

export function usePersistedChatMessages({ serverMessages, messagesRef, setMessages, status, enabled }: {
  serverMessages: ChatMessage[];
  messagesRef: RefObject<ChatMessage[]>;
  setMessages: (messages: ChatMessage[]) => void;
  status: ChatStatus;
  enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled || status === "streaming" || status === "submitted") return;
    const current = messagesRef.current;
    const next = reconcilePersistedMessages(current, serverMessages);
    if (next !== current) setMessages(next);
  }, [enabled, messagesRef, serverMessages, setMessages, status]);
}
