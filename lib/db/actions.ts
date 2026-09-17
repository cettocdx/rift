import { archiveMessage } from "./archive-message";
import "server-only";
import { WorkerChatSnapshot } from "./worker-chat-snapshot";

import { api } from "@/convex/_generated/api";
import { ChatSDKError } from "../errors";
import { getConvexClient, getConvexServiceKey } from "./convex-client";
import { UIMessage, UIMessagePart } from "ai";
import { extractFileIdsFromParts } from "@/lib/utils/file-token-utils";
import {
  extractAllFileIdsFromMessages,
  getFileTokensByIds,
  truncateMessagesWithFileTokens,
} from "@/lib/utils/file-token-utils";
import {
  countMessagesTokens,
  getMessageTokenBudget,
  truncateMessagesToTokenLimit,
} from "@/lib/token-utils";
import { fixIncompleteMessageParts } from "@/lib/chat/chat-processor";
import {
  compactMessageForStorage,
  type OffloadedEvidence,
} from "@/lib/chat/compaction/prune-tool-outputs";
import type { SubscriptionTier, NoteCategory } from "@/types";
import type { Id } from "@/convex/_generated/dataModel";
import { v4 as uuidv4 } from "uuid";
import { AGENT_RESUME_PREAMBLE } from "@/lib/chat/summarization/prompts";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import { hasRestageableLocalDesktopAttachments } from "@/lib/utils/local-attachment-messages";
import {
  getContextHistoryPageLimit,
  type ContextLimitOptions,
} from "@/lib/token-limits";
import { coerceChatPurpose, type ChatMode } from "@/types/chat";
import { getMessagePersistenceDiagnostics } from "./message-persistence-diagnostics";
import { sanitizeForConvexValue } from "./convex-value-sanitizer";
import { stringifyRedactedError } from "@/lib/utils/error-redaction";

const MAX_DATABASE_ERROR_MESSAGE_LENGTH = 500;
const MAX_DATABASE_ERROR_DATA_STRING_LENGTH = 500;
const MAX_DATABASE_ERROR_DATA_BYTES = 4 * 1024;
const MAX_DATABASE_ERROR_DATA_DEPTH = 3;
const MAX_DATABASE_ERROR_DATA_ARRAY_LENGTH = 20;
const LARGE_MESSAGE_SAVE_WARNING_BYTES = 850 * 1024;
const REDACTED_ERROR_DATA_VALUE = "[Redacted]";

const sensitiveErrorDataKeys = new Set([
  "authorization",
  "body",
  "content",
  "cookie",
  "cookies",
  "file",
  "files",
  "headers",
  "messages",
  "output",
  "parts",
  "password",
  "prompt",
  "request",
  "requestbody",
  "response",
  "responsebody",
  "result",
  "text",
  "token",
]);

const stringifyError = (error: unknown): string => {
  return stringifyRedactedError(error);
};

const getErrorData = (error: unknown): unknown => {
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { data?: unknown }).data;
  return data === undefined ? undefined : sanitizeErrorData(data);
};

const getJsonByteLength = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf-8");
  } catch {
    return 0;
  }
};

const truncateErrorDataString = (value: string): string =>
  value.length > MAX_DATABASE_ERROR_DATA_STRING_LENGTH
    ? `${value.slice(0, MAX_DATABASE_ERROR_DATA_STRING_LENGTH)}...`
    : value;

const isSensitiveErrorDataKey = (key: string): boolean => {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
  return (
    sensitiveErrorDataKeys.has(normalized) ||
    /apikey|authorization|bearer|cookie|password|secret|servicekey/.test(
      normalized,
    )
  );
};

const summarizeErrorDataObject = (value: object) => ({
  truncated: true,
  keys: Object.keys(value).slice(0, MAX_DATABASE_ERROR_DATA_ARRAY_LENGTH),
});

const sanitizeErrorDataValue = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown => {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return truncateErrorDataString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }
  if (typeof value !== "object") return String(value);

  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DATABASE_ERROR_DATA_DEPTH) {
    return summarizeErrorDataObject(value);
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, MAX_DATABASE_ERROR_DATA_ARRAY_LENGTH)
      .map((item) => sanitizeErrorDataValue(item, depth + 1, seen));
    if (value.length > MAX_DATABASE_ERROR_DATA_ARRAY_LENGTH) {
      sanitized.push({
        truncated: true,
        remaining: value.length - MAX_DATABASE_ERROR_DATA_ARRAY_LENGTH,
      });
    }
    seen.delete(value);
    return sanitized;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    sanitized[key] = isSensitiveErrorDataKey(key)
      ? REDACTED_ERROR_DATA_VALUE
      : sanitizeErrorDataValue(childValue, depth + 1, seen);
  }

  seen.delete(value);
  return sanitized;
};

const sanitizeErrorData = (data: unknown): unknown => {
  const sanitized = sanitizeErrorDataValue(data, 0, new WeakSet<object>());
  const sizeBytes = getJsonByteLength(sanitized);
  if (sizeBytes <= MAX_DATABASE_ERROR_DATA_BYTES) return sanitized;

  if (sanitized && typeof sanitized === "object") {
    return {
      truncated: true,
      size_bytes: sizeBytes,
      keys: Object.keys(sanitized).slice(
        0,
        MAX_DATABASE_ERROR_DATA_ARRAY_LENGTH,
      ),
    };
  }

  return {
    truncated: true,
    size_bytes: sizeBytes,
  };
};

const truncateDiagnosticString = (value: string): string =>
  value.length > MAX_DATABASE_ERROR_MESSAGE_LENGTH
    ? `${value.slice(0, MAX_DATABASE_ERROR_MESSAGE_LENGTH)}...`
    : value;

const getObjectString = (value: unknown, key: string): string | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const child = (value as Record<string, unknown>)[key];
  return typeof child === "string" ? child : undefined;
};

const getNestedObject = (
  value: unknown,
  key: string,
): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === "object" && !Array.isArray(child)
    ? (child as Record<string, unknown>)
    : undefined;
};

const getDatabaseErrorCode = (data: unknown): string | undefined =>
  getObjectString(data, "code") ??
  getObjectString(getNestedObject(data, "causeData"), "code");

const getDatabaseFailureStage = (data: unknown): string | undefined =>
  getObjectString(data, "failureStage");

const isChatNotFoundMessageSaveError = (
  operation: string,
  dbErrorData: unknown,
): boolean =>
  operation === "messages.saveMessage" &&
  getDatabaseErrorCode(dbErrorData) === "CHAT_NOT_FOUND";

const logChatMessagePreparationFailure = (
  event: string,
  level: "warn" | "error",
  fields: Record<string, unknown>,
) => {
  const payload = {
    level,
    event,
    service: "chat-handler",
    timestamp: new Date().toISOString(),
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === "warn") {
    console.warn(line);
  } else {
    console.error(line);
  }
};

const databaseError = (
  operation: string,
  error: unknown,
  metadata: Record<string, unknown> = {},
) => {
  const dbErrorName = error instanceof Error ? error.name : typeof error;
  const dbErrorMessage = truncateDiagnosticString(stringifyError(error));
  const dbErrorData = getErrorData(error);
  const isChatNotFound = isChatNotFoundMessageSaveError(operation, dbErrorData);
  const diagnosticMetadata = {
    db_operation: operation,
    db_error_name: dbErrorName,
    db_error_message: dbErrorMessage,
    db_error_data: dbErrorData,
    db_error_code: getDatabaseErrorCode(dbErrorData),
    db_failure_stage: getDatabaseFailureStage(dbErrorData),
    ...metadata,
  };

  const logPayload = {
    level: isChatNotFound ? "warn" : "error",
    event: isChatNotFound
      ? "database_operation_skipped_chat_not_found"
      : "database_operation_failed",
    service: "chat-handler",
    timestamp: new Date().toISOString(),
    ...diagnosticMetadata,
  };

  const logLine = JSON.stringify(logPayload);
  if (isChatNotFound) {
    console.warn(logLine);
  } else {
    console.error(logLine);
  }

  return new ChatSDKError(
    isChatNotFound ? "not_found:chat" : "bad_request:database",
    isChatNotFound
      ? `Chat no longer exists while saving message: ${operation}: ${dbErrorMessage}`
      : `Database operation failed: ${operation}: ${dbErrorMessage}`,
    diagnosticMetadata,
  );
};

export async function getChatById({ id }: { id: string }) {
  try {
    const selectedChat = await getConvexClient().query(api.chats.getChatById, {
      serviceKey: getConvexServiceKey()!,
      id,
    });
    return selectedChat;
  } catch (error) {
    throw databaseError("chats.getChatById", error, { chat_id: id });
  }
}

export async function getActiveProjectForUser({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  try {
    return await getConvexClient().query(api.projects.getActiveForBackend, {
      serviceKey: getConvexServiceKey()!,
      id: projectId as Id<"projects">,
      userId,
    });
  } catch (_error) {
    // Invalid Convex IDs and unavailable/foreign projects have the same
    // user-facing outcome. Keep raw validator details out of the response.
    throw new ChatSDKError(
      "forbidden:chat",
      "The selected project is not available.",
      {
        project_context_invalid: true,
      },
    );
  }
}

export async function getBotMeetingForRuntime(args: {
  userId: string;
  id: Id<"bot_meetings">;
  chatId: string;
  projectId: Id<"projects">;
}) {
  return getConvexClient().query(api.botMeetings.getForRuntime, {
    ...args,
    serviceKey: getConvexServiceKey()!,
  });
}

export async function getProjectBotForRuntime(args: {
  userId: string;
  id: Id<"project_bots">;
  chatId: string;
  projectId: Id<"projects">;
}) {
  return getConvexClient().query(api.projectBots.getForRuntime, {
    ...args,
    serviceKey: getConvexServiceKey()!,
  });
}

export async function saveChat({
  id,
  userId,
  title,
  purpose,
  projectId,
}: {
  id: string;
  userId: string;
  title: string;
  purpose?: string;
  projectId?: Id<"projects">;
}) {
  try {
    return await getConvexClient().mutation(api.chats.saveChat, {
      serviceKey: getConvexServiceKey()!,
      id,
      userId,
      title,
      ...(purpose ? { purpose } : {}),
      ...(projectId ? { projectId } : {}),
    });
  } catch (error) {
    throw databaseError("chats.saveChat", error, {
      chat_id: id,
      user_id: userId,
      title_length: title.length,
    });
  }
}
/**
 * Stores the evidence compaction lifted out of a message.
 *
 * Each write is independent and failure-tolerant: evidence is a record of the
 * run, never a precondition for saving the message it came from. A failure here
 * costs the detail of one tool call, not the conversation.
 */
async function persistOffloadedEvidence({
  chatId,
  userId,
  messageId,
  offloaded,
}: {
  chatId: string;
  userId: string;
  messageId: string;
  offloaded: OffloadedEvidence[];
}): Promise<void> {
  const client = getConvexClient();

  const results = await Promise.allSettled(
    offloaded.map((item) =>
      client.mutation(api.runs.recordEvidence, {
        serviceKey: getConvexServiceKey()!,
        chatId,
        userId,
        toolCallId: item.toolCallId,
        kind: item.kind,
        content: item.content,
        command: item.command,
        exitCode: item.exitCode,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        durationMs: item.durationMs,
      }),
    ),
  );

  const failed = results.filter(
    (result) => result.status === "rejected",
  ).length;
  if (failed > 0) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "offloaded_evidence_partially_failed",
        service: "chat-handler",
        timestamp: new Date().toISOString(),
        chat_id: chatId,
        message_id: messageId,
        attempted: offloaded.length,
        failed,
      }),
    );
  }
}

export async function saveMessage({
  chatId,
  userId,
  expectedTriggerRunId,
  message,
  extraFileIds,
  model,
  mode,
  generationStartedAt,
  generationTimeMs,
  finishReason,
  usage,
  updateOnly,
  isHidden,
  wasAborted,
  wasPreemptiveTimeout,
}: {
  chatId: string;
  userId: string;
  expectedTriggerRunId?: string;
  message: {
    id: string;
    role: "user" | "assistant" | "system";
    parts: UIMessagePart<any, any>[];
  };
  extraFileIds?: Array<Id<"files">>;
  model?: string;
  mode?: ChatMode;
  generationStartedAt?: number;
  generationTimeMs?: number;
  finishReason?: string;
  usage?: Record<string, unknown>;
  updateOnly?: boolean;
  isHidden?: boolean;
  wasAborted?: boolean;
  wasPreemptiveTimeout?: boolean;
}) {
  let fixedParts = message.parts;
  let partsForSave = message.parts;
  let persistenceDiagnostics = getMessagePersistenceDiagnostics(partsForSave);

  try {
    // Fix incomplete tool invocations for assistant messages (from interrupted streams)
    fixedParts =
      message.role === "assistant"
        ? fixIncompleteMessageParts(message.parts, {
            logContext: {
              service: "chat-handler",
              source: "save_message",
              chatId,
              userId,
              messageId: message.id,
              mode,
              finishReason,
              updateOnly,
            },
          })
        : message.parts;
    const convexSafeParts = sanitizeForConvexValue(fixedParts) as UIMessagePart<
      any,
      any
    >[];
    const storageSafeMessage =
      message.role === "assistant"
        ? compactMessageForStorage({ ...message, parts: convexSafeParts })
        : null;
    let storageSafeParts = storageSafeMessage?.message.parts ?? convexSafeParts;
    if (storageSafeMessage?.compacted) {
      // Required, not best-effort: never replace detail with a placeholder
      // until its complete original has been committed to file storage.
      const archive = await archiveMessage({
        message: { ...message, parts: convexSafeParts },
        userId,
        serviceKey: getConvexServiceKey()!,
      });
      storageSafeParts = [...storageSafeParts, archive];
    }
    if (storageSafeMessage?.compacted) {
      console.info("[db] compacted assistant message before save", {
        chatId,
        messageId: message.id,
        beforeSizeBytes: storageSafeMessage.beforeSizeBytes,
        afterSizeBytes: storageSafeMessage.afterSizeBytes,
        prunedCount: storageSafeMessage.prunedCount,
        strippedUiOnlyFields: storageSafeMessage.strippedUiOnlyFields,
        strippedTerminalParts: storageSafeMessage.strippedTerminalParts,
        excerptedInputs: storageSafeMessage.excerptedInputs,
        offloadedEvidenceCount: storageSafeMessage.offloaded?.length ?? 0,
      });
    }
    // Compaction that ran and still did not fit is the exact shape of the
    // failure this cascade exists to prevent: the write below is about to be
    // refused for size, and an hour of finished work goes with it. It is
    // logged as an error on its own so it is findable BEFORE the database
    // says no, rather than being read backwards out of a stack trace.
    if (storageSafeMessage && !storageSafeMessage.fitsSoftLimit) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "assistant_message_exceeds_storage_budget",
          service: "chat-handler",
          chat_id: chatId,
          message_id: message.id,
          before_size_bytes: storageSafeMessage.beforeSizeBytes,
          after_size_bytes: storageSafeMessage.afterSizeBytes,
          excerpted_inputs: storageSafeMessage.excerptedInputs,
          pruned_count: storageSafeMessage.prunedCount,
        }),
      );
    }

    // What compaction removed is stored beside the message rather than dropped.
    // Best-effort and awaited: a message must still save if evidence does not,
    // but the write is ordered before the save so a reader never sees a
    // placeholder whose evidence has not landed yet.
    if (storageSafeMessage?.offloaded?.length) {
      await persistOffloadedEvidence({
        chatId,
        userId,
        messageId: message.id,
        offloaded: storageSafeMessage.offloaded,
      });
    }

    partsForSave = sanitizeForConvexValue(storageSafeParts) as UIMessagePart<
      any,
      any
    >[];
    persistenceDiagnostics = getMessagePersistenceDiagnostics(partsForSave);
    if (
      message.role === "assistant" &&
      persistenceDiagnostics.parts_size_bytes > LARGE_MESSAGE_SAVE_WARNING_BYTES
    ) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "large_message_save_attempt",
          service: "chat-handler",
          timestamp: new Date().toISOString(),
          chat_id: chatId,
          user_id: userId,
          message_id: message.id,
          mode,
          model,
          finish_reason: finishReason,
          ...persistenceDiagnostics,
        }),
      );
    }

    // Extract file IDs from file parts
    const fileIds = extractFileIdsFromParts(partsForSave);
    const mergedFileIds = Array.from(
      new Set([
        ...fileIds,
        ...extractFileIdsFromParts(convexSafeParts),
        ...((extraFileIds || []).filter(Boolean) as string[]),
      ]),
    );

    return await getConvexClient().mutation(api.messages.saveMessage, {
      serviceKey: getConvexServiceKey()!,
      id: message.id,
      chatId,
      userId,
      expectedTriggerRunId,
      role: message.role,
      parts: partsForSave,
      fileIds: mergedFileIds.length > 0 ? (mergedFileIds as any) : undefined,
      model,
      mode,
      generationStartedAt,
      generationTimeMs,
      finishReason,
      usage,
      updateOnly,
      isHidden,
    });
  } catch (error) {
    if (
      expectedTriggerRunId !== undefined &&
      getDatabaseErrorCode(getNestedObject(error, "data")) === "AGENT_RUN_LOST"
    ) {
      throw error;
    }
    throw databaseError("messages.saveMessage", error, {
      chat_id: chatId,
      user_id: userId,
      message_id: message.id,
      message_role: message.role,
      mode,
      model,
      finish_reason: finishReason,
      update_only: updateOnly === true,
      hidden: isHidden === true,
      was_aborted: wasAborted,
      was_preemptive_timeout: wasPreemptiveTimeout,
      extra_file_count: extraFileIds?.length ?? 0,
      usage_keys: usage ? Object.keys(usage).sort() : undefined,
      ...persistenceDiagnostics,
    });
  }
}

export async function handleInitialChatAndUserMessage({
  chatId,
  userId,
  messages,
  regenerate,
  chat,
  isHidden,
  purpose,
  projectId,
}: {
  chatId: string;
  userId: string;
  messages: { id: string; parts: UIMessagePart<any, any>[] }[];
  regenerate?: boolean;
  chat: any; // Chat data from getMessagesByChatId
  isHidden?: boolean;
  purpose?: string;
  projectId?: Id<"projects">;
}) {
  if (!chat) {
    // Save new chat and get the document _id
    let title = "New Chat";

    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (
        lastMessage?.parts &&
        Array.isArray(lastMessage.parts) &&
        lastMessage.parts.length > 0
      ) {
        const firstPart = lastMessage.parts[0];
        if (firstPart?.type === "text" && firstPart.text) {
          title = firstPart.text;
        }
      }
    }

    // Ensure title is a string and truncate safely
    title = (title ?? "New Chat").substring(0, 100);

    await saveChat({
      id: chatId,
      userId,
      title,
      purpose,
      projectId,
    });
  } else {
    // Check if user owns the chat
    if (chat.user_id !== userId) {
      throw new ChatSDKError(
        "forbidden:chat",
        "You don't have permission to access this chat",
      );
    }
  }

  // Only save user message if this is not a regeneration
  if (!regenerate && Array.isArray(messages) && messages.length > 0) {
    await saveMessage({
      chatId,
      userId,
      message: {
        id: messages[messages.length - 1].id,
        role: "user",
        parts: messages[messages.length - 1].parts,
      },
      isHidden,
    });
  }
}

export async function updateChat({
  chatId,
  expectedTriggerRunId,
  expectedStreamId,
  title,
  finishReason,
  todos,
  defaultModelSlug,
  sandboxType,
  selectedModel,
}: {
  chatId: string;
  expectedTriggerRunId?: string;
  expectedStreamId?: string;
  title?: string;
  finishReason?: string;
  todos?: Array<{
    id: string;
    content: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
    sourceMessageId?: string;
  }>;
  defaultModelSlug?: "ask" | "agent";
  sandboxType?: string;
  selectedModel?: string;
}) {
  try {
    return await getConvexClient().mutation(api.chats.updateChat, {
      serviceKey: getConvexServiceKey()!,
      chatId,
      expectedTriggerRunId,
      expectedStreamId,
      title,
      finishReason,
      todos,
      defaultModelSlug,
      sandboxType,
      selectedModel,
    });
  } catch (error) {
    throw new ChatSDKError(
      "bad_request:database",
      `Failed to update chat: ${error}`,
    );
  }
}

export async function getMessagesByChatId({
  chatId,
  userId,
  newMessages,
  regenerate,
  subscription,
  isTemporary,
  mode,
  useClientMessagesForRegenerate,
  context,
  workerChatSnapshot,
  workerRunId,
  hasPaidContextPromise,
}: {
  chatId: string;
  userId: string;
  subscription: SubscriptionTier;
  newMessages: UIMessage[];
  regenerate?: boolean;
  isTemporary?: boolean;
  mode?: import("@/types").ChatMode;
  useClientMessagesForRegenerate?: boolean;
  context?: ContextLimitOptions;
  workerChatSnapshot?: WorkerChatSnapshot;
  workerRunId?: string;
  /** Verified capacity may resolve while the first authorized history page loads. */
  hasPaidContextPromise?: Promise<boolean>;
}) {
  // For temporary chats, skip database operations
  let chat = undefined;
  let isNewChat = true;
  let existingMessages: UIMessage[] = [];
  let contextOptions: ContextLimitOptions = { ...context, mode };
  const paidContextReady = hasPaidContextPromise?.then((hasPaidContext) => {
    contextOptions = { ...contextOptions, hasPaidContext };
  });
  // Validation or an earlier read can fail before this dependency is awaited.
  void paidContextReady?.catch(() => {});

  if (!isTemporary) {
    // Only a successful, matching worker activation may bypass this read.
    // A confirmed null snapshot is distinct from an omitted snapshot.
    if (workerChatSnapshot !== undefined) {
      if (!(workerChatSnapshot instanceof WorkerChatSnapshot) || !workerRunId) {
        throw new Error("Invalid worker chat snapshot");
      }
      chat = workerChatSnapshot.read({ userId, chatId, runId: workerRunId });
    } else {
      chat = await getChatById({ id: chatId });
    }
    isNewChat = !chat;
    contextOptions = {
      ...contextOptions,
      purpose: chat?.purpose
        ? coerceChatPurpose(chat.purpose)
        : context?.purpose,
    };

    const shouldUseClientMessagesForRegenerate =
      !!regenerate &&
      !!useClientMessagesForRegenerate &&
      Array.isArray(newMessages) &&
      newMessages.length > 0 &&
      hasRestageableLocalDesktopAttachments(newMessages);

    if (!isNewChat && shouldUseClientMessagesForRegenerate) {
      // Persisted local desktop attachments are saved without source paths.
      // When the current client still has those paths, use that trimmed
      // history for this regenerate so the files can be staged again.
      existingMessages = newMessages;
    }

    // Only fetch existing messages if chat exists
    if (!isNewChat && !shouldUseClientMessagesForRegenerate) {
      try {
        // Fetch latest summary only if chat has a summary ID
        const latestSummary = chat?.latest_summary_id
          ? await getLatestSummary({ chatId })
          : null;

        // Adaptive paginated backfill: fetch pages until token budget is hit or cap reached
        const PAGE_SIZE = 24;
        const readPage = (cursor: string | null) =>
          getConvexClient().query(api.messages.getMessagesPageForBackend, {
            serviceKey: getConvexServiceKey()!,
            chatId,
            userId,
            paginationOpts: { numItems: PAGE_SIZE, cursor },
          });
        // Every context permits at least one page. Start that owner-filtered
        // read now, but do not truncate or request more pages until capacity is
        // verified. Promise.all observes either rejection while the other waits.
        const [firstPage] = await Promise.all([
          readPage(null),
          paidContextReady,
        ]);
        const MAX_PAGES = getContextHistoryPageLimit(
          subscription,
          contextOptions,
        );

        let cursor: string | null = null;
        let pagesFetched = 0;
        let fetchedDesc: UIMessage[] = [];
        let truncatedFromLoop: UIMessage[] | null = null;
        let fileTokensFromLoop: Record<Id<"files">, number> = {};
        const skipFileTokens = mode === "agent";

        while (pagesFetched < MAX_PAGES) {
          const pageResult: {
            page: UIMessage[];
            isDone: boolean;
            continueCursor: string | null;
          } = pagesFetched === 0 ? firstPage : await readPage(cursor);
          const { page, isDone, continueCursor: nextCursor } = pageResult;

          fetchedDesc = fetchedDesc.concat(page);
          pagesFetched++;

          const existingChrono = [...fetchedDesc].reverse();
          const candidate =
            regenerate && !isTemporary
              ? existingChrono
              : [...existingChrono, ...newMessages];

          // Incrementally fetch file tokens only for new file IDs not yet cached
          if (!skipFileTokens) {
            const allFileIds = extractAllFileIdsFromMessages(candidate);
            const uncachedIds = allFileIds.filter(
              (id) => !(id in fileTokensFromLoop),
            );
            if (uncachedIds.length > 0) {
              const newTokens = await getFileTokensByIds(uncachedIds, userId);
              Object.assign(fileTokensFromLoop, newTokens);
            }
          }

          const maxTokens = getMessageTokenBudget(subscription, contextOptions);
          const truncatedMessages = truncateMessagesToTokenLimit(
            candidate,
            fileTokensFromLoop,
            maxTokens,
          );

          const hitBudget = truncatedMessages.length < candidate.length;
          const reachedLimit = isDone || pagesFetched >= MAX_PAGES;

          if (hitBudget || reachedLimit) {
            truncatedFromLoop = truncatedMessages;
            break;
          }

          cursor = nextCursor || null;
          if (!cursor) {
            // No more pages
            truncatedFromLoop = truncatedMessages;
            break;
          }
        }

        // In regenerate mode the conversation must end with a user message.
        // The client should have deleted the last assistant message before
        // calling regenerate, but if that hasn't propagated yet we must
        // strip it here so all return paths below (summary early-return,
        // no-summary early-return, and the fallthrough) stay consistent.
        if (regenerate && !isTemporary && truncatedFromLoop) {
          while (
            truncatedFromLoop.length > 0 &&
            truncatedFromLoop[truncatedFromLoop.length - 1].role === "assistant"
          ) {
            truncatedFromLoop = truncatedFromLoop.slice(0, -1);
          }
        }

        // If loop didn't run or didn't set, fall back to whatever we accumulated
        if (!fetchedDesc.length && !truncatedFromLoop) {
          existingMessages = [];
        } else if (!truncatedFromLoop) {
          // Use all fetched messages chronologically as existing
          existingMessages = [...fetchedDesc].reverse();
        } else {
          // Apply summary if it exists (regardless of current mode)
          // Note: Summaries are only created in agent mode but provide value in any mode
          if (latestSummary) {
            const summaryUpToId = latestSummary.summary_up_to_message_id;

            // Find cutoff index once
            const cutoffIndex = truncatedFromLoop.findIndex(
              (m) => m.id === summaryUpToId,
            );

            // Keep messages that come after the cutoff
            const messagesAfterCutoff =
              cutoffIndex >= 0
                ? truncatedFromLoop.slice(cutoffIndex + 1)
                : truncatedFromLoop;

            // Create summary message, prepending resume preamble for agent modes
            const summaryPrefix =
              mode && isAgentMode(mode) ? AGENT_RESUME_PREAMBLE : "";
            const summaryMessage: UIMessage = {
              id: uuidv4(),
              role: "user",
              parts: [
                {
                  type: "text",
                  text: `${summaryPrefix}<context_summary>\n${latestSummary.summary_text}\n</context_summary>`,
                },
              ],
            };

            // Re-truncate real messages to leave room for the summary message
            const maxTokens = getMessageTokenBudget(
              subscription,
              contextOptions,
            );
            const summaryTokens = countMessagesTokens(
              [summaryMessage],
              fileTokensFromLoop,
            );
            const budgetForMessages = maxTokens - summaryTokens;
            const truncatedAfterCutoff =
              budgetForMessages > 0
                ? truncateMessagesToTokenLimit(
                    messagesAfterCutoff,
                    fileTokensFromLoop,
                    budgetForMessages,
                  )
                : [];
            const truncatedWithSummary: UIMessage[] = [
              summaryMessage,
              ...truncatedAfterCutoff,
            ];

            return {
              truncatedMessages: truncatedWithSummary,
              chat,
              isNewChat,
              fileTokens: fileTokensFromLoop,
            };
          }

          // No summary injection (ask mode or no summary), return as normal
          return {
            truncatedMessages: truncatedFromLoop,
            chat,
            isNewChat,
            fileTokens: fileTokensFromLoop,
          };
        }
      } catch (error) {
        // A rejected entitlement dependency must never become history fallback.
        await paidContextReady;
        logChatMessagePreparationFailure("chat_history_fetch_failed", "warn", {
          chat_id: chatId,
          user_id: userId,
          mode,
          is_temporary: !!isTemporary,
          regenerate: !!regenerate,
          new_messages_count: newMessages.length,
          error_name: error instanceof Error ? error.name : typeof error,
          error_message: truncateDiagnosticString(stringifyError(error)),
          db_error_data: getErrorData(error),
        });

        if (newMessages.length === 0) {
          throw databaseError("messages.getMessagesPageForBackend", error, {
            chat_id: chatId,
            user_id: userId,
            mode,
            is_temporary: !!isTemporary,
            regenerate: !!regenerate,
            new_messages_count: newMessages.length,
          });
        }
      }
    }
  }

  // Temporary, absent-chat and client-regenerate paths have no history page.
  await paidContextReady;

  // Handle message merging based on regeneration flag
  let allMessages: UIMessage[];

  if (regenerate && !isTemporary) {
    // Don't append new messages — use existing history up to the last user message
    allMessages = existingMessages;
    // Defensively strip trailing assistant messages.
    // The client should have deleted the last assistant message before
    // calling regenerate, but if that hasn't propagated yet we must
    // ensure the conversation ends with a user message.
    while (
      allMessages.length > 0 &&
      allMessages[allMessages.length - 1].role === "assistant"
    ) {
      allMessages = allMessages.slice(0, -1);
    }
  } else {
    // For normal chat, merge existing messages with the new user message
    allMessages = [...existingMessages, ...newMessages];
  }

  const truncateResult = await truncateMessagesWithFileTokens(
    allMessages,
    subscription,
    mode === "agent", // Skip file tokens for agent mode (files go to sandbox)
    mode,
    userId,
    contextOptions,
  );
  const truncatedMessages = truncateResult.messages;
  const fileTokens = truncateResult.fileTokens;

  if (!truncatedMessages || truncatedMessages.length === 0) {
    let emptyPromptMetadata: Record<string, unknown> | undefined;
    try {
      const fileIds = extractAllFileIdsFromMessages(allMessages);
      const fileTokens = await getFileTokensByIds(fileIds as any, userId);
      const maxTokens = getMessageTokenBudget(subscription, contextOptions);
      const totalTokensBefore = countMessagesTokens(allMessages, fileTokens);
      const largestFileToken = Object.values(fileTokens).length
        ? Math.max(...Object.values(fileTokens))
        : 0;
      emptyPromptMetadata = {
        chat_id: chatId,
        user_id: userId,
        is_temporary: !!isTemporary,
        regenerate: !!regenerate,
        subscription,
        mode,
        existing_messages_count: existingMessages.length,
        new_messages_count: newMessages.length,
        all_messages_count: allMessages.length,
        total_tokens_before: totalTokensBefore,
        max_tokens: maxTokens,
        file_ids_count: fileIds.length,
        file_tokens_sample: Object.entries(fileTokens)
          .slice(0, 5)
          .map(([k, v]) => ({ fileId: k, tokens: v })),
        largest_file_token: largestFileToken,
      };
      logChatMessagePreparationFailure(
        allMessages.length === 0
          ? "chat_prompt_empty"
          : "chat_truncation_dropped_all_messages",
        "error",
        emptyPromptMetadata,
      );
    } catch {}

    if (allMessages.length === 0) {
      throw new ChatSDKError(
        "bad_request:api",
        "No message content was found for this request. Please send a new message and try again.",
        {
          empty_prompt: true,
          ...emptyPromptMetadata,
        },
      );
    }

    throw new ChatSDKError(
      "bad_request:api",
      "Your input (including any attached files) is too large to process. Please remove some attachments or shorten your message and try again.",
      {
        truncation_dropped_all_messages: true,
        ...emptyPromptMetadata,
      },
    );
  }

  return { truncatedMessages, chat, isNewChat, fileTokens };
}

export async function getUserCustomization({ userId }: { userId: string }) {
  try {
    const userCustomization = await getConvexClient().query(
      api.userCustomization.getUserCustomizationForBackend,
      {
        serviceKey: getConvexServiceKey()!,
        userId,
      },
    );
    return userCustomization;
  } catch (error) {
    // If no customization found or error, return null
    return null;
  }
}

export async function setActiveTriggerRun({
  chatId,
  triggerRunId,
  expectedRunId,
}: {
  chatId: string;
  triggerRunId: string | null;
  expectedRunId?: string;
}) {
  try {
    await getConvexClient().mutation(api.chats.setActiveTriggerRun, {
      serviceKey: getConvexServiceKey()!,
      chatId,
      triggerRunId,
      ...(expectedRunId !== undefined ? { expectedRunId } : {}),
    });
  } catch (error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to set active trigger run",
    );
  }
}

/** Remember which OpenCode session (and sandbox) a chat's Build engine is using. */
export async function setChatOpenCodeSession({
  chatId,
  sessionId,
  sandboxId,
}: {
  chatId: string;
  sessionId: string | null;
  sandboxId?: string;
}) {
  try {
    await getConvexClient().mutation(api.chats.setOpenCodeSession, {
      serviceKey: getConvexServiceKey()!,
      chatId,
      sessionId,
      ...(sandboxId !== undefined ? { sandboxId } : {}),
    });
  } catch {
    // Best-effort: losing the binding only costs session continuity next leg.
  }
}

export async function getActiveTriggerRun({ chatId }: { chatId: string }) {
  try {
    return await getConvexClient().query(api.chats.getActiveTriggerRun, {
      serviceKey: getConvexServiceKey()!,
      chatId,
    });
  } catch (error) {
    return null;
  }
}

export async function startStream({
  chatId,
  streamId,
}: {
  chatId: string;
  streamId: string;
}) {
  try {
    await getConvexClient().mutation(api.chatStreams.startStream, {
      serviceKey: getConvexServiceKey()!,
      chatId,
      streamId,
    });
    return;
  } catch (error) {
    throw new ChatSDKError("bad_request:database", "Failed to start stream");
  }
}

export async function prepareForNewStream({
  chatId,
  expectedTriggerRunId,
  expectedStreamId,
}: {
  chatId: string;
  expectedTriggerRunId?: string;
  expectedStreamId?: string;
}) {
  try {
    await getConvexClient().mutation(api.chatStreams.prepareForNewStream, {
      serviceKey: getConvexServiceKey()!,
      chatId,
      expectedTriggerRunId,
      expectedStreamId,
    });
    return;
  } catch (error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to prepare for new stream",
    );
  }
}

export async function getCancellationStatus({ chatId }: { chatId: string }) {
  try {
    const status = await getConvexClient().query(
      api.chatStreams.getCancellationStatus,
      {
        serviceKey: getConvexServiceKey()!,
        chatId,
      },
    );
    return status;
  } catch (error) {
    // Silently return null on error for cancellation checks
    return null;
  }
}

// Temporary chat stream coordination
export async function startTempStream({
  chatId,
  userId,
}: {
  chatId: string;
  userId: string;
}) {
  try {
    await getConvexClient().mutation(api.tempStreams.startTempStream, {
      serviceKey: getConvexServiceKey()!,
      chatId,
      userId,
    });
  } catch (error) {
    // Do not throw; temp coordination best-effort
  }
}

export async function getTempCancellationStatus({
  chatId,
}: {
  chatId: string;
}) {
  try {
    return await getConvexClient().query(
      api.tempStreams.getTempCancellationStatus,
      {
        serviceKey: getConvexServiceKey()!,
        chatId,
      },
    );
  } catch (error) {
    return null;
  }
}

export async function deleteTempStreamForBackend({
  chatId,
}: {
  chatId: string;
}) {
  try {
    await getConvexClient().mutation(
      api.tempStreams.deleteTempStreamForBackend,
      {
        serviceKey: getConvexServiceKey()!,
        chatId,
      },
    );
  } catch (error) {
    // Best-effort cleanup
  }
}

export async function saveChatSummary({
  chatId,
  summaryText,
  summaryUpToMessageId,
}: {
  chatId: string;
  summaryText: string;
  summaryUpToMessageId: string;
}) {
  try {
    await getConvexClient().mutation(api.chats.saveLatestSummary, {
      serviceKey: getConvexServiceKey()!,
      chatId,
      summaryText,
      summaryUpToMessageId,
    });

    return;
  } catch (error) {
    console.error("[DB Actions] Failed to save chat summary", {
      chatId,
      summaryUpToMessageId,
      summaryTextLength: summaryText.length,
      summaryTextSizeKB: Math.round(
        Buffer.byteLength(summaryText, "utf-8") / 1024,
      ),
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw new ChatSDKError(
      "bad_request:database",
      error instanceof Error ? error.message : "Failed to save chat summary",
    );
  }
}

export async function getLatestSummary({ chatId }: { chatId: string }) {
  try {
    const summary = await getConvexClient().query(
      api.chats.getLatestSummaryForBackend,
      {
        serviceKey: getConvexServiceKey()!,
        chatId,
      },
    );
    return summary;
  } catch (error) {
    console.error("[DB Actions] Failed to get latest summary:", error);
    return null;
  }
}

// ============================================================================
// Notes Actions
// ============================================================================

export async function createNote({
  userId,
  title,
  content,
  category,
  tags,
}: {
  userId: string;
  title: string;
  content: string;
  category?: NoteCategory;
  tags?: string[];
}) {
  try {
    const result = await getConvexClient().mutation(
      api.notes.createNoteForBackend,
      {
        serviceKey: getConvexServiceKey()!,
        userId,
        title,
        content,
        category,
        tags,
      },
    );
    return result;
  } catch (error) {
    throw new ChatSDKError(
      "bad_request:database",
      error instanceof Error ? error.message : "Failed to create note",
    );
  }
}

export async function listNotes({
  userId,
  category,
  tags,
  search,
}: {
  userId: string;
  category?: NoteCategory;
  tags?: string[];
  search?: string;
}) {
  try {
    const result = await getConvexClient().query(
      api.notes.listNotesForBackend,
      {
        serviceKey: getConvexServiceKey()!,
        userId,
        category,
        tags,
        search,
      },
    );
    return result;
  } catch (error) {
    throw new ChatSDKError(
      "bad_request:database",
      error instanceof Error ? error.message : "Failed to list notes",
    );
  }
}

export async function updateNote({
  userId,
  noteId,
  title,
  content,
  tags,
}: {
  userId: string;
  noteId: string;
  title?: string;
  content?: string;
  tags?: string[];
}) {
  try {
    const result = await getConvexClient().mutation(
      api.notes.updateNoteForBackend,
      {
        serviceKey: getConvexServiceKey()!,
        userId,
        noteId,
        title,
        content,
        tags,
      },
    );
    return result;
  } catch (error) {
    throw new ChatSDKError(
      "bad_request:database",
      error instanceof Error ? error.message : "Failed to update note",
    );
  }
}

export async function deleteNote({
  userId,
  noteId,
}: {
  userId: string;
  noteId: string;
}) {
  try {
    const result = await getConvexClient().mutation(
      api.notes.deleteNoteForBackend,
      {
        serviceKey: getConvexServiceKey()!,
        userId,
        noteId,
      },
    );
    return result;
  } catch (error) {
    throw new ChatSDKError(
      "bad_request:database",
      error instanceof Error ? error.message : "Failed to delete note",
    );
  }
}

export async function getNotes({
  userId,
  subscription,
}: {
  userId: string;
  subscription: SubscriptionTier;
}) {
  try {
    const notes = await getConvexClient().query(api.notes.getNotesForBackend, {
      serviceKey: getConvexServiceKey()!,
      userId,
      subscription,
    });
    return notes;
  } catch (error) {
    // If no notes found or error, return empty array
    return [];
  }
}

export async function logUsageRecord({
  userId,
  organizationId,
  chatId,
  endpoint,
  mode,
  subscription,
  model,
  type,
  inputTokens,
  outputTokens,
  totalTokens,
  cacheReadTokens,
  cacheWriteTokens,
  costDollars,
  modelCostDollars,
  nonModelCostDollars,
  costSource,
}: {
  userId: string;
  organizationId?: string;
  chatId?: string;
  endpoint?:
    | "/api/chat"
    | "/api/agent-long"
    | "/api/hack-long"
    | "/api/console/model";
  mode?: ChatMode;
  subscription?: SubscriptionTier;
  model: string;
  type: "included" | "extra";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costDollars: number;
  modelCostDollars?: number;
  nonModelCostDollars?: number;
  costSource?: "provider" | "token_estimate";
}) {
  try {
    await getConvexClient().mutation(api.usageLogs.logUsage, {
      serviceKey: getConvexServiceKey()!,
      user_id: userId,
      organization_id: organizationId,
      chat_id: chatId,
      endpoint,
      mode,
      subscription,
      model,
      type,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cache_write_tokens: cacheWriteTokens,
      total_tokens: totalTokens,
      cost_dollars: costDollars,
      model_cost_dollars: modelCostDollars,
      non_model_cost_dollars: nonModelCostDollars,
      cost_source: costSource,
    });
  } catch (error) {
    console.error("Failed to log usage record:", {
      error,
      userId,
      organizationId,
      chatId,
      endpoint,
      mode,
      subscription,
      model,
      type,
      costDollars,
      modelCostDollars,
      nonModelCostDollars,
      costSource,
      inputTokens,
      outputTokens,
    });
  }
}
