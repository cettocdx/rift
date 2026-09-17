import type { ChatMessage, ChatStatus } from "@/types/chat";

export const INTERRUPTED_RESPONSE_MESSAGE =
  "RIFT stopped before it could finish this response. Your message is saved — retry to continue.";

export const LOST_AGENT_CONNECTION_MESSAGE =
  "RIFT lost the live agent connection before it could finish this response. Your message is saved — retry or reconnect.";

export const AGENT_WORKER_FAILED_MESSAGE =
  "RIFT's background run stopped unexpectedly. Your message is saved. Review the recorded work before retrying.";

export const AGENT_START_TIMEOUT_MESSAGE =
  "RIFT could not start this agent run in time. Your message is saved — retry or reconnect.";

/** Shared by recovery scheduling and presentation so transient errors agree. */
export function isConnectionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as {
    name?: unknown;
    type?: unknown;
    surface?: unknown;
    message?: unknown;
  };
  return (
    failure.name === "TypeError" ||
    (failure.type === "offline" && failure.surface === "chat") ||
    failure.message === AGENT_START_TIMEOUT_MESSAGE ||
    failure.message === LOST_AGENT_CONNECTION_MESSAGE
  );
}

type InterruptedResponseState = {
  isExistingChat: boolean;
  chatLoaded: boolean;
  hasActiveStream: boolean;
  status: ChatStatus;
  hasClientError: boolean;
  messages: readonly ChatMessage[];
  /** When the user cancelled this chat's last run, from the chat row. */
  canceledAt?: number | null;
  /** Current run failure; cleared atomically when a replacement run activates. */
  lastRunError?: string | null;
};

/**
 * Detects the durable gap left when a user message was saved but the producer
 * disappeared, including failures after partial assistant output. Live requests
 * surface their own transport error; this guard is for reloads/reconnects where useChat no
 * longer has the original in-memory error.
 */
export function hasInterruptedPersistedResponse({
  isExistingChat,
  chatLoaded,
  hasActiveStream,
  status,
  hasClientError,
  messages,
  canceledAt,
  lastRunError,
}: InterruptedResponseState): boolean {
  if (
    !isExistingChat ||
    !chatLoaded ||
    hasActiveStream ||
    status !== "ready" ||
    hasClientError
  ) {
    return false;
  }

  // A run the user stopped leaves exactly the state this guard looks for: a
  // saved user message, no assistant turn, no active stream. Reporting that as
  // "RIFT stopped before it could finish" blames the product for doing what it
  // was told. The chat row records the cancellation, so ask it.
  if (canceledAt) return false;

  // Partial output is saved even when the run fails. Its assistant role alone
  // does not establish completion; the current durable failure takes priority.
  if (lastRunError) return true;

  const lastVisibleMessage = [...messages]
    .reverse()
    .find((message) => !message.metadata?.isAutoContinue);

  return lastVisibleMessage?.role === "user";
}
