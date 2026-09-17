import { HackDispatchState } from "./hack-dispatch-state";
import { Chat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type ChatInit,
  type ChatTransport,
  type DataUIPart,
} from "ai";
import type { ChatMessage } from "@/types/chat";
import { RetainedContinuationController } from "@/lib/chat/retained-continuation";
import { consumeDispatchReceiptMetadata } from "@/lib/chat/dispatch-receipt";

type ChatCallbacks = Pick<
  ChatInit<ChatMessage>,
  "onData" | "onToolCall" | "onFinish" | "onError" | "sendAutomaticallyWhen"
>;

// Retain presentation state only. Replaying command-like parts (especially
// auto-continue / appendMessage) would execute a second request on remount.
const PRESENTATION_TYPES = new Set([
  "data-title",
  "data-context-usage",
  "data-upload-status",
  "data-summarization",
  "data-rate-limit-warning",
  "data-sandbox-fallback",
  "data-file-metadata",
]);
const MAX_RETAINED_DATA_PARTS = 256;
const MAX_IDLE_SESSIONS = 40;

export class RetainedChatBusyError extends Error {
  readonly code = "chat_resuming";
  constructor() {
    super(
      "This conversation is reconnecting. Your draft is saved; try again in a moment.",
    );
    this.name = "RetainedChatBusyError";
  }
}

/** A transport and SDK reader outlive their current route, but its UI callbacks do not. */
export class RetainedChatSession {
  readonly chat: Chat<ChatMessage>;
  readonly hackDispatch = new HackDispatchState();
  hasAttached = false;
  private owner: symbol | null = null;
  private callbacks: ChatCallbacks = {};
  private transport: ChatTransport<ChatMessage>;
  private data: DataUIPart<any>[] = [];
  private resumeAbort: (() => void) | null = null;
  private resumePromise: Promise<void> | null = null;
  private disposed = false;
  private readonly continuation: RetainedContinuationController;
  private readonly continuationListeners = new Set<() => void>();

  constructor(
    options: ChatInit<ChatMessage>,
    private readonly isAvailable: () => boolean,
    enableContinuation = true,
  ) {
    this.transport =
      options.transport ?? new DefaultChatTransport<ChatMessage>();
    const transport: ChatTransport<ChatMessage> = {
      sendMessages: async (request) => {
        const { metadata, receipt } = consumeDispatchReceiptMetadata(
          request.metadata,
        );
        try {
          this.assertAvailable();
          // Capture the transport at dispatch. Reattaching a view can update the
          // next request's preferences without replacing an in-flight request.
          const current = this.transport;
          const stream = await current.sendMessages(
            receipt ? { ...request, metadata } : request,
          );
          // The SDK's sendMessage promise waits for the entire stream and may
          // resolve even after errors. Acceptance belongs at this boundary.
          receipt?.accepted();
          return stream;
        } catch (error) {
          receipt?.failed(error);
          throw error;
        }
      },
      reconnectToStream: (request) => {
        this.assertAvailable();
        const current = this.transport;
        return current.reconnectToStream(request);
      },
    };
    this.chat = new Chat<ChatMessage>({
      ...options,
      transport,
      onData: (part) => {
        if (!this.available()) return;
        this.continuation.onData(part);
        if (PRESENTATION_TYPES.has(part.type)) {
          // Singleton state supersedes older values. File metadata is
          // incremental, so keep its events in order for the existing merger.
          const previous =
            part.type === "data-file-metadata"
              ? this.data
              : this.data.filter((cached) => cached.type !== part.type);
          this.data = [...previous, part].slice(-MAX_RETAINED_DATA_PARTS);
        }
        this.activeCallbacks()?.onData?.(part);
      },
      onToolCall: (event) => this.activeCallbacks()?.onToolCall?.(event),
      onFinish: (event) => {
        this.resumeAbort = null;
        if (!event.isAbort && !event.isError && !event.isDisconnect)
          this.continuation.onFinish();
        this.activeCallbacks()?.onFinish?.(event);
      },
      onError: (error) => {
        this.resumeAbort = null;
        this.continuation.onError(error);
        this.activeCallbacks()?.onError?.(error);
      },
      sendAutomaticallyWhen: async (event) => {
        const owner = this.owner;
        const accepted =
          await this.activeCallbacks()?.sendAutomaticallyWhen?.(event);
        return Boolean(
          accepted && owner && this.owner === owner && this.available(),
        );
      },
    });
    this.continuation = new RetainedContinuationController({
      getStatus: () => this.chat.status,
      getError: () => this.chat.error,
      isAvailable: () => enableContinuation && this.available(),
      sendMessage: (message, requestOptions) =>
        this.chat.sendMessage(message, requestOptions),
      onChange: () => {
        for (const listener of this.continuationListeners) listener();
      },
    });
  }

  private available = () => !this.disposed && this.isAvailable();

  private assertAvailable() {
    if (!this.available())
      throw new Error("This chat session is no longer available.");
  }

  private activeCallbacks() {
    return this.owner && this.available() ? this.callbacks : null;
  }

  attach(owner: symbol, options: ChatInit<ChatMessage>) {
    this.owner = owner;
    this.hasAttached = true;
    this.update(owner, options);
  }

  update(owner: symbol, options: ChatInit<ChatMessage>) {
    if (this.owner !== owner || this.disposed) return;
    this.callbacks = options;
    if (options.transport) this.transport = options.transport;
  }

  detach(owner: symbol) {
    if (this.owner !== owner) return;
    this.owner = null;
    this.callbacks = {};
  }

  get canEvict() {
    return (
      !this.owner &&
      !this.hackDispatch.unresolved &&
      !this.resumePromise &&
      !this.continuation.pending &&
      this.chat.status !== "submitted" &&
      this.chat.status !== "streaming"
    );
  }

  getRetainedMessages = () => this.chat.messages;
  getRetainedDataStream = () => this.data;
  getContinuationPending = () => this.continuation.pending;
  subscribeToContinuation = (listener: () => void) => {
    this.continuationListeners.add(listener);
    return () => {
      this.continuationListeners.delete(listener);
    };
  };
  setMessages = (
    value: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[]),
  ) => {
    if (this.disposed) return;
    this.chat.messages =
      typeof value === "function" ? value(this.chat.messages) : value;
  };

  registerRequestContext = (body: Record<string, unknown>) => {
    if (!this.available()) return;
    this.continuation.setRequestContext(body);
  };

  sendMessage: Chat<ChatMessage>["sendMessage"] = (message, options) => {
    const { receipt } = consumeDispatchReceiptMetadata(options?.metadata);
    try {
      this.assertAvailable();
      if (this.resumePromise) throw new RetainedChatBusyError();
      const requestBody = options?.body as
        | { isAutoContinue?: unknown }
        | undefined;
      if (requestBody?.isAutoContinue !== true) this.continuation.reset();
      return this.chat.sendMessage(message, options).catch((error) => {
        // SDK validation/file conversion can reject before transport dispatch.
        // One-shot settlement ignores any rejection after accepted().
        receipt?.failed(error);
        throw error;
      });
    } catch (error) {
      receipt?.failed(error);
      throw error;
    }
  };

  regenerate: Chat<ChatMessage>["regenerate"] = (options) => {
    this.assertAvailable();
    if (this.resumePromise) throw new RetainedChatBusyError();
    this.continuation.reset();
    return this.chat.regenerate(options);
  };

  /** The SDK has no signal for a reconnect GET; its fetch registers this separately. */
  registerResumeAbort = (abort: () => void): (() => void) => {
    if (!this.available()) {
      abort();
      return () => {};
    }
    if (this.resumeAbort !== abort) this.abortRetainedResume();
    this.resumeAbort = abort;
    return () => {
      if (this.resumeAbort === abort) this.resumeAbort = null;
    };
  };

  abortRetainedResume = () => {
    const abort = this.resumeAbort;
    this.resumeAbort = null;
    abort?.();
  };

  stopRetainedReader = async () => {
    // Mark the SDK response aborted before cancelling the transport so its
    // finalizer treats this as a stop, not a network error.
    const stopping = this.chat.stop();
    this.abortRetainedResume();
    await stopping;
  };

  stop = async () => {
    this.continuation.stop();
    await this.stopRetainedReader();
  };

  resumeStream: Chat<ChatMessage>["resumeStream"] = (options) => {
    if (this.resumePromise) return this.resumePromise;
    this.assertAvailable();
    if (this.chat.status === "submitted" || this.chat.status === "streaming")
      return Promise.resolve();
    const pending = this.chat.resumeStream(options);
    this.resumePromise = pending;
    const settle = () => {
      if (this.resumePromise === pending) this.resumePromise = null;
    };
    void pending.then(settle, settle);
    return pending;
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.owner = null;
    this.callbacks = {};
    this.data = [];
    this.continuation.dispose();
    this.hackDispatch.dispose();
    this.continuationListeners.clear();
    void this.stopRetainedReader().catch(() => {});
  }
}

/** Authenticated-shell memory, never a module singleton or persisted browser storage. */
export class RetainedChatRegistry {
  private sessions = new Map<string, RetainedChatSession>();
  private active = false;
  private epoch = 0;

  constructor(private readonly enableContinuation = true) {}

  getMessageCount(chatId: string) {
    return this.sessions.get(chatId)?.getRetainedMessages().length ?? 0;
  }

  connect() {
    this.active = true;
    this.epoch += 1;
  }

  disconnect() {
    this.active = false;
    const epoch = ++this.epoch;
    // React StrictMode replays layout effects. Cancel disposal if the same
    // provider reconnects in that commit; a real logout stays inactive.
    queueMicrotask(() => {
      if (this.active || epoch !== this.epoch) return;
      for (const session of this.sessions.values()) session.dispose();
      this.sessions.clear();
    });
  }

  acquire(options: ChatInit<ChatMessage> & { id: string }) {
    const existing = this.sessions.get(options.id);
    if (existing) {
      this.sessions.delete(options.id);
      this.sessions.set(options.id, existing);
      return { session: existing, retained: existing.hasAttached };
    }
    const session = new RetainedChatSession(
      options,
      () => this.active,
      this.enableContinuation,
    );
    this.sessions.set(options.id, session);
    if (this.sessions.size > MAX_IDLE_SESSIONS) {
      for (const [id, candidate] of this.sessions) {
        if (this.sessions.size <= MAX_IDLE_SESSIONS) break;
        if (candidate === session || !candidate.canEvict) continue;
        candidate.dispose();
        this.sessions.delete(id);
      }
    }
    return { session, retained: false };
  }
}
