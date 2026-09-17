import { createDispatchReceiptMetadata } from "@/lib/chat/dispatch-receipt";
import {
  needsWorkReconciliation,
  RECONCILE_WORK_REQUEST,
} from "@/lib/chat/recovery-request";
import { RefObject, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useGlobalState } from "../contexts/GlobalState";
import { onLaunchOperation } from "@/lib/utils/launch-operation";
import { onSubmitChatMessage } from "@/lib/utils/submit-message";
import { useInputApi } from "../contexts/InputContext";
import { useLatestRef } from "@/app/hooks/useLatestRef";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import { shouldUseAgentLongForAgent } from "@/lib/chat/agent-routing";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import type { ChatMessage, ChatMode, ChatStatus } from "@/types";
import { Id } from "@/convex/_generated/dataModel";
import { countInputTokens } from "@/lib/client-token-estimate";
import { getMaxFileTokens, getMessageTokenBudget } from "@/lib/token-limits";
import { toast } from "sonner";
import { removeTodosBySourceMessages } from "@/lib/utils/todo-utils";
import { useDataStreamDispatch } from "@/app/components/DataStreamProvider";
import { normalizeMessages } from "@/lib/utils/message-processor";
import {
  getAutoContinueChainAssistantIds,
  getMessagesUpToLastRealUser,
} from "@/lib/utils/message-utils";
import {
  createFileMessagePartFromUploadedFile,
  getMaxFilesLimitForMode,
} from "@/lib/utils/file-utils";
import { hasRestageableLocalDesktopAttachments } from "@/lib/utils/local-attachment-messages";
import { resolveMediaRequest } from "@/lib/ai/media-intent";
import { resolveChatModeForPurpose } from "@/types/chat";
import { prepareWorkingFileRequest } from "@/lib/composer/working-file-request";
import { readWorkingFileRequestContext } from "@/lib/composer/working-file-store";

interface UseChatHandlersProps {
  chatId: string;
  messages: ChatMessage[];
  sendMessage: (
    message?: any,
    options?: { body?: any; metadata?: unknown },
  ) => void | Promise<void>;
  stop: () => void;
  regenerate: (options?: { body?: any }) => void;
  setMessages: (
    messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => void;
  isExistingChat: boolean;
  status: ChatStatus;
  isSendingNowRef: RefObject<boolean>;
  hasManuallyStoppedRef: RefObject<boolean>;
  onStopCallback?: () => void;
  resetAutoContinueCount?: () => void;
  retryError?: Error;
}

export const useChatHandlers = ({
  chatId,
  messages,
  sendMessage,
  stop,
  regenerate,
  setMessages,
  isExistingChat,
  status,
  isSendingNowRef,
  hasManuallyStoppedRef,
  onStopCallback,
  resetAutoContinueCount,
  retryError,
}: UseChatHandlersProps) => {
  const { setIsAutoResuming } = useDataStreamDispatch();
  const { inputRef, clearInput } = useInputApi();
  const {
    uploadedFiles,
    chatMode,
    setChatMode,
    clearUploadedFiles,
    todos,
    setTodos,
    isUploadingFiles,
    subscription,
    hasPaidContext,
    temporaryChatsEnabled,
    queueMessage,
    claimQueuedMessage,
    queueBehavior,
    sandboxPreference,
    selectedModel,
    setSelectedModel,
    chatPurpose,
    desktopBridgeActive,
    isSelectedSandboxAvailable,
  } = useGlobalState();

  // Avoid stale closure on temporary flag
  const temporaryChatsEnabledRef = useRef(temporaryChatsEnabled);
  useEffect(() => {
    temporaryChatsEnabledRef.current = temporaryChatsEnabled;
  }, [temporaryChatsEnabled]);

  // Avoid stale closure on chatMode: on mobile, a tap on Regenerate can fire
  // before React commits the new chatMode after a mode toggle, sending the
  // previous mode in the request body. Reading from a ref always gets the
  // latest value at the moment of the click.
  const chatModeRef = useLatestRef(chatMode);
  const sandboxPreferenceRef = useLatestRef(sandboxPreference);
  const subscriptionRef = useLatestRef(subscription);
  const submissionInFlightRef = useRef(false);

  // The legacy operation event is deliberately rejected by the normal chat
  // transport. Hack Workbench owns its own Max-gated command entry and request
  // route, so Build and Studio cannot recreate pentest execution through a
  // palette event (or a forged browser CustomEvent).
  useEffect(
    () =>
      onLaunchOperation(() => {
        toast.error("Security operations require Hack Workbench", {
          description:
            "Open Hack Workbench to run authorized pentest operations.",
        });
      }),
    [],
  );

  // Programmatic message submit (e.g. Plan-mode question cards): send `text`
  // as a normal user message in the CURRENT chat mode — no operation badge,
  // no mode switch. Ref keeps the send config fresh for the once-subscribed
  // listener.
  const submitMessageRef = useRef<(text: string) => Promise<boolean>>(
    async () => false,
  );
  useEffect(
    () => onSubmitChatMessage((text) => submitMessageRef.current(text)),
    [],
  );

  const isSendableUploadedFile = (file: (typeof uploadedFiles)[number]) =>
    file.uploaded &&
    !file.uploading &&
    !file.error &&
    (file.storage === "local-desktop"
      ? !!file.localAttachmentId && !!file.localPath
      : !!file.url && !!file.fileId);

  const deleteLastAssistantMessage = useMutation(
    api.messages.deleteLastAssistantMessage,
  );
  const saveAssistantMessage = useMutation(api.messages.saveAssistantMessage);
  const regenerateWithNewContent = useMutation(
    api.messages.regenerateWithNewContent,
  );
  const cancelStreamMutation = useMutation(
    api.chatStreams.cancelStreamFromClient,
  );
  const cancelTempStreamMutation = useMutation(
    api.tempStreams.cancelTempStreamFromClient,
  );

  // Mirrors the transport routing rule in app/components/chat.tsx. Both
  // persistent and temporary Agent chats run through Trigger.dev; temporary
  // chats are resolved server-side through authenticated Trigger tags.
  const shouldCancelTriggerRun = () =>
    shouldUseAgentLongForAgent({
      mode: chatModeRef.current,
      subscription: subscriptionRef.current,
      isTauri: isTauriEnvironment(),
    });

  const cancelTriggerRun = async (): Promise<{ chatMissing?: boolean }> => {
    if (!shouldCancelTriggerRun()) return {};
    const response = await fetch("/api/agent-long/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        temporary: temporaryChatsEnabledRef.current,
        allowMissingChat: !isExistingChat,
      }),
    });
    if (!response.ok) {
      throw new Error(`Agent cancellation failed (${response.status})`);
    }
    // HTTP success alone does not acknowledge durable cancellation. Unknown
    // or malformed receipts must preserve the pending replacement request.
    const result = (await response.json().catch(() => null)) as {
      canceled?: unknown;
      reason?: unknown;
      chatMissing?: unknown;
    } | null;
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      !(
        result.canceled === true ||
        (result.canceled === false && result.reason === "no_active_run")
      )
    ) {
      throw new Error("Agent cancellation not confirmed");
    }
    return { chatMissing: result?.chatMissing === true };
  };

  /**
   * Helper to stop an active stream, normalize messages, and persist state.
   * Returns the normalized messages array.
   * Should be called before any message management operation during streaming.
   */
  const stopActiveStream = async (options?: {
    skipSave?: boolean;
  }): Promise<ChatMessage[]> => {
    // Stop the stream immediately (client-side abort)
    stop();

    // Also stop the durable server-side run. Several actions (regenerate,
    // retry, edit, and send-now) share this helper, so keeping cancellation
    // here prevents an old Trigger.dev run from continuing beside its
    // replacement and mutating the same workspace concurrently.
    const triggerCancellationPromise = cancelTriggerRun();

    // Early return if no messages to process
    if (messages.length === 0) {
      await triggerCancellationPromise;
      return messages;
    }

    // Normalize messages to mark incomplete tools as interrupted/completed
    const { messages: normalizedMessages, hasChanges } =
      normalizeMessages(messages);

    const stopTime = Date.now();
    const normalizedLastMessage =
      normalizedMessages[normalizedMessages.length - 1];
    const generationStartedAt =
      typeof normalizedLastMessage?.metadata?.generationStartedAt === "number"
        ? normalizedLastMessage.metadata.generationStartedAt
        : undefined;
    const generationTimeMs =
      generationStartedAt !== undefined
        ? Math.max(0, stopTime - generationStartedAt)
        : undefined;
    const stoppedMessages =
      normalizedLastMessage?.role === "assistant" &&
      generationTimeMs !== undefined
        ? [
            ...normalizedMessages.slice(0, -1),
            {
              ...normalizedLastMessage,
              metadata: {
                ...normalizedLastMessage.metadata,
                mode:
                  normalizedLastMessage.metadata?.mode ?? chatModeRef.current,
                generationStartedAt,
                generationTimeMs,
              },
            },
          ]
        : normalizedMessages;

    // Update local state if changes were made
    if (hasChanges || stoppedMessages !== normalizedMessages) {
      setMessages(stoppedMessages);
    }

    if (!temporaryChatsEnabledRef.current) {
      // Run cancel and save in parallel - they're independent operations
      const lastMessage = stoppedMessages[stoppedMessages.length - 1];
      const savePromise =
        !options?.skipSave && lastMessage?.role === "assistant"
          ? saveAssistantMessage({
              id: lastMessage.id,
              chatId,
              role: lastMessage.role,
              parts: lastMessage.parts,
              mode: lastMessage.metadata?.mode ?? chatModeRef.current,
              generationStartedAt,
              generationTimeMs,
              // Durable marker so this turn stays recognizable as stopped after
              // the chat's transient canceled_at is cleared by the next run.
              stopReason: "user",
            }).catch((error) => {
              console.error("Failed to save message on stop:", error);
            })
          : Promise.resolve();

      await Promise.all([
        triggerCancellationPromise,
        cancelStreamMutation({
          chatId,
          skipSave: options?.skipSave || undefined,
        }).catch((error) => {
          console.error("Failed to cancel stream:", error);
        }),
        savePromise,
      ]);
    } else {
      // Temporary chats: signal cancel via temp stream coordination
      await Promise.all([
        triggerCancellationPromise,
        cancelTempStreamMutation({ chatId }).catch(() => {}),
      ]);
    }

    return normalizedMessages;
  };

  const handleSubmit = async (
    e: React.FormEvent,
    submission?: {
      input?: string;
      mode?: ChatMode;
      isolated?: boolean;
      source?: "console" | "programmatic";
      isCurrent?: () => boolean;
    },
  ): Promise<boolean> => {
    e.preventDefault();
    if (submissionInFlightRef.current || submission?.isCurrent?.() === false) {
      return false;
    }
    submissionInFlightRef.current = true;
    try {
      // Read the latest composer text from the ref so this handler does not have
      // to subscribe to the reactive input value (which would re-render chat.tsx
      // on every keystroke).
      const input = submission?.input ?? inputRef.current;
      // Scratch agent tests are text-only submissions. The user's composer
      // draft can remain open across routes and must not be sent or cleared.
      const consoleSubmission = submission?.source === "console";
      const programmaticSubmission = submission?.source === "programmatic";
      const isolated =
        !consoleSubmission &&
        !programmaticSubmission &&
        submission?.isolated === true;
      const preserveComposer =
        isolated || consoleSubmission || programmaticSubmission;
      const submissionFiles = preserveComposer ? [] : uploadedFiles;

      // Check the original-file capability before dispatch or clearing anything.
      // A live relay alone is insufficient: another folder may keep it connected
      // after this chat's selected file was revoked.
      if (
        !isolated &&
        chatPurpose === "app" &&
        readWorkingFileRequestContext(chatId)
      ) {
        try {
          await prepareWorkingFileRequest(chatId, desktopBridgeActive);
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Reconnect your working file before sending.",
          );
          return false;
        }
      }

      if (submission?.isCurrent?.() === false) return false;

      setIsAutoResuming(false);

      // Reset manual stop flag when user submits a new message
      hasManuallyStoppedRef.current = false;
      resetAutoContinueCount?.();

      // Prevent submission if files are still uploading
      if (!preserveComposer && isUploadingFiles) {
        return false;
      }
      // Allow submission if there's text input or uploaded files
      const hasValidFiles = submissionFiles.some(isSendableUploadedFile);
      if (input.trim() || hasValidFiles) {
        const mediaRequest = resolveMediaRequest({
          purpose: chatPurpose,
          prompt: input,
          selectedModel,
        });
        const requestedMode = submission?.mode ?? chatModeRef.current;
        const currentChatMode = resolveChatModeForPurpose({
          purpose: chatPurpose,
          selectedModel: mediaRequest.selectedModel,
          fallbackMode: requestedMode,
        });
        if (mediaRequest.selectionChanged) {
          setSelectedModel(mediaRequest.selectedModel);
        }
        if (currentChatMode !== chatModeRef.current) {
          setChatMode(currentChatMode);
        }
        if (
          isAgentMode(currentChatMode) &&
          sandboxPreferenceRef.current !== "e2b" &&
          isSelectedSandboxAvailable === false
        ) {
          toast.error("The selected computer is disconnected", {
            description:
              "Reconnect that computer or choose another execution target. Your draft is kept.",
          });
          return false;
        }

        const maxFilesLimit = getMaxFilesLimitForMode(currentChatMode);
        if (submissionFiles.length > maxFilesLimit) {
          toast.error("Cannot send files in this mode", {
            description: `Maximum ${maxFilesLimit} files allowed. Please remove some files or switch modes.`,
          });
          return false;
        }

        const hasLocalDesktopFiles = submissionFiles.some(
          (file) => file.storage === "local-desktop",
        );
        if (
          hasLocalDesktopFiles &&
          (!isAgentMode(currentChatMode) ||
            sandboxPreferenceRef.current !== "desktop")
        ) {
          toast.error("Local attachments require desktop Agent mode", {
            description:
              "Switch back to Agent mode with the desktop sandbox or reattach the file for upload.",
          });
          return false;
        }

        // Check token limit before sending based on user plan
        const tokenCount = countInputTokens(input, submissionFiles);
        const maxTokens = getMessageTokenBudget(subscription, {
          mode: currentChatMode,
          model: mediaRequest.selectedModel,
          purpose: chatPurpose,
          hasPaidContext,
        });

        // Additional validation for Ask mode: ensure files don't exceed Ask mode token limits
        // This prevents uploading files in Agent mode then switching to Ask mode to send them
        if (currentChatMode === "ask" && submissionFiles.length > 0) {
          const fileTokens = submissionFiles.reduce(
            (total, file) => total + (file.tokens || 0),
            0,
          );
          const maxFileTokens = getMaxFileTokens(subscription);
          if (fileTokens > maxFileTokens) {
            toast.error("Cannot send files in Ask mode", {
              description: `Files exceed Ask mode token limit (${fileTokens.toLocaleString()}/${maxFileTokens.toLocaleString()} tokens). Tip: Switch to Agent mode or remove large files.`,
            });
            return false;
          }
        }

        if (tokenCount > maxTokens) {
          const hasFiles = submissionFiles.length > 0;
          const planText = subscription !== "free" ? "" : " (Free plan limit)";
          toast.error("Message is too long", {
            description: `Your message is too large (${tokenCount.toLocaleString()} tokens). Please make it shorter${hasFiles ? " or remove some files" : ""}${planText}.`,
          });
          return false;
        }

        // If streaming in Agent mode, check queue behavior
        if (
          status === "streaming" ||
          (status === "submitted" &&
            (consoleSubmission ||
              programmaticSubmission ||
              queueBehavior === "queue"))
        ) {
          const validFiles = submissionFiles
            .filter(isSendableUploadedFile)
            .map(createFileMessagePartFromUploadedFile)
            .filter((part): part is NonNullable<typeof part> => part !== null);

          if (queueBehavior === "queue") {
            // Queue the message - will auto-send after current response completes
            const queued = queueMessage(input, validFiles);
            if (!queued.accepted) return false;
            if (!preserveComposer && inputRef.current === input) {
              clearInput();
              clearUploadedFiles();
            }
            return true;
          } else if (queueBehavior === "stop-and-send") {
            // A local abort is insufficient: do not overlap workspace tasks
            // when the durable cancellation acknowledgement is unknown.
            try {
              await stopActiveStream();
            } catch (error) {
              hasManuallyStoppedRef.current = true;
              console.error(
                "Stop-and-send: durable cancel did not confirm",
                error,
              );
              toast.error("The previous task could not be stopped", {
                description:
                  "Your draft and attachments are kept. Confirm the task has stopped before trying again.",
              });
              return false;
            }
            if (submission?.isCurrent?.() === false) return false;
            // Continue to send the new message immediately below (don't return)
          }
        }
        try {
          // Get file objects from uploaded files - URLs are already resolved in global state
          const validFiles = submissionFiles
            .filter(isSendableUploadedFile)
            .map(createFileMessagePartFromUploadedFile)
            .filter((part): part is NonNullable<typeof part> => part !== null);

          // Question cards need transport acceptance before locking their answer.
          // The SDK promise lasts for the full stream, so use its local receipt.
          let settleReceipt: ((accepted: boolean) => void) | undefined;
          const receipt = programmaticSubmission
            ? new Promise<boolean>((resolve) => {
                settleReceipt = resolve;
              })
            : undefined;
          const receiptMetadata = receipt
            ? createDispatchReceiptMetadata({
                accepted: () => settleReceipt?.(true),
                failed: () => settleReceipt?.(false),
              })
            : undefined;
          const sending = sendMessage(
            {
              text: input.trim() || undefined,
              files: validFiles.length > 0 ? validFiles : undefined,
              metadata: { createdAt: Date.now() },
            },
            {
              ...(receipt ? { metadata: receiptMetadata } : {}),
              body: {
                mode: currentChatMode,
                todos,
                temporary: temporaryChatsEnabled,
                sandboxPreference,

                selectedModel: mediaRequest.selectedModel,
              },
            },
          );
          if (receipt) {
            // A rejected SDK call (or completion without acceptance) is failure.
            // Void-returning senders may still deliver an asynchronous receipt.
            if (sending) {
              void Promise.resolve(sending).then(
                () => settleReceipt?.(false),
                () => settleReceipt?.(false),
              );
            }
            if (!(await receipt)) return false;
          } else {
            void Promise.resolve(sending).catch((error) => {
              console.error("Failed to submit message:", error);
            });
          }
        } catch (error) {
          if (
            error instanceof Error &&
            error.name === "RetainedChatBusyError"
          ) {
            toast.info(error.message);
            return false;
          }
          // Never retry by sending a second text-only turn: the first dispatch
          // may already have reached the transport before throwing.
          console.error("Failed to submit message:", error);
          toast.error("Your message could not be sent. Please try again.");
          return false;
        }

        if (!preserveComposer && inputRef.current === input) {
          clearInput();
          clearUploadedFiles();
        }
        return true;
      }
      return false;
    } finally {
      submissionInFlightRef.current = false;
    }
  };

  useEffect(() => {
    submitMessageRef.current = (text) =>
      handleSubmit({ preventDefault() {} } as React.FormEvent, {
        input: text,
        source: "programmatic",
      });
  });

  const handleStop = async () => {
    setIsAutoResuming(false);

    // Set manual stop flag to prevent auto-processing of queue
    hasManuallyStoppedRef.current = true;

    // Clear any active status indicators immediately
    onStopCallback?.();

    try {
      await stopActiveStream();
    } catch (error) {
      // The local stream is already aborted, so the UI looks stopped. If the
      // durable server-side cancel did not confirm, the run may still be
      // executing -- say so instead of swallowing it.
      toast.error("Stop may not have reached the server", {
        description:
          "The run could still be finishing on the server. Reload if it keeps going.",
      });
    }
  };

  const prepareReplacement = async (): Promise<
    false | { chatMissing?: boolean }
  > => {
    try {
      if (status === "streaming") {
        await stopActiveStream({ skipSave: true });
      } else {
        // A disconnected reader can still have a live durable run.
        return await cancelTriggerRun();
      }
      return {};
    } catch {
      toast.error("Couldn't confirm the previous run has stopped", {
        description:
          "Your messages are saved. Try again before starting another run.",
      });
      return false;
    }
  };

  const handleRegenerate = async () => {
    setIsAutoResuming(false);
    resetAutoContinueCount?.();

    // Stop any active stream first to prevent message order issues and wasted tokens
    if (!(await prepareReplacement())) return;

    // Remove todos from all assistant messages in the auto-continue chain.
    const chainAssistantIds = getAutoContinueChainAssistantIds(messages);
    const cleanedTodos =
      chainAssistantIds.length > 0
        ? removeTodosBySourceMessages(todos, chainAssistantIds)
        : todos;
    if (cleanedTodos !== todos) setTodos(cleanedTodos);

    // Trim client-side message state to the last real user message.
    // Without this, the SDK's regenerate() only removes the last assistant,
    // leaving old auto-continue chain messages visible in the UI.
    const trimmedMessages = getMessagesUpToLastRealUser(messages);
    setMessages(trimmedMessages);

    const shouldSendClientMessagesForRegenerate =
      hasRestageableLocalDesktopAttachments(trimmedMessages);
    const persistentRegenerateMessages = shouldSendClientMessagesForRegenerate
      ? trimmedMessages
      : [];

    if (!temporaryChatsEnabled) {
      // Delete the entire trailing auto-continue chain (all assistant + hidden user messages)
      // back to the last real user message, so regeneration starts from the original request
      if (chainAssistantIds.length > 0) {
        await deleteLastAssistantMessage({
          chatId,
          todos: cleanedTodos,
        });
      }
      // For persisted chats, backend fetches from database - explicitly send no messages
      regenerate({
        body: {
          mode: chatModeRef.current,
          messages: persistentRegenerateMessages,
          todos: cleanedTodos,
          regenerate: true,
          useClientMessagesForRegenerate: shouldSendClientMessagesForRegenerate,
          temporary: false,
          sandboxPreference,
          selectedModel,
        },
      });
    } else {
      regenerate({
        body: {
          mode: chatModeRef.current,
          messages: trimmedMessages,
          todos: cleanedTodos,
          regenerate: true,
          temporary: true,
          sandboxPreference,
          selectedModel,
        },
      });
    }
  };

  const retryInFlight = useRef(false);
  const handleRetryAttempt = async () => {
    setIsAutoResuming(false);
    resetAutoContinueCount?.();

    // Stop any active stream first to prevent message order issues and wasted tokens
    const cancellation = await prepareReplacement();
    if (!cancellation) return;
    const retryDraft = cancellation.chatMissing === true;

    if (chatPurpose === "app" && needsWorkReconciliation(retryError)) {
      hasManuallyStoppedRef.current = false;
      // Deliberately visible, with a new request id. Keep all saved tool
      // evidence and do not mark this as an automatic continuation/replay.
      await sendMessage(
        { text: RECONCILE_WORK_REQUEST },
        {
          body: {
            mode: chatModeRef.current,
            todos,
            temporary: temporaryChatsEnabled,
            sandboxPreference,
            selectedModel,
            purpose: chatPurpose,
          },
        },
      );
      return;
    }

    const cleanedTodos = removeTodosBySourceMessages(
      todos,
      todos
        .filter((t) => t.sourceMessageId)
        .map((t) => t.sourceMessageId as string),
    );
    if (cleanedTodos !== todos) setTodos(cleanedTodos);
    if (!temporaryChatsEnabled) {
      // For persisted chats, backend fetches from database - explicitly send no messages
      await regenerate({
        body: {
          mode: chatModeRef.current,
          messages: retryDraft ? getMessagesUpToLastRealUser(messages) : [],
          todos: cleanedTodos,
          regenerate: !retryDraft,
          temporary: false,
          sandboxPreference,
          selectedModel,
        },
      });
    } else {
      // For temporary chats, filter out empty assistant message if present (from error)
      // Check if last message is an empty assistant message
      const lastMessage = messages[messages.length - 1];
      const isLastMessageEmptyAssistant =
        lastMessage?.role === "assistant" &&
        (!lastMessage.parts || lastMessage.parts.length === 0);

      const messagesToSend = isLastMessageEmptyAssistant
        ? messages.slice(0, -1)
        : messages;

      await regenerate({
        body: {
          mode: chatModeRef.current,
          messages: messagesToSend,
          todos: cleanedTodos,
          regenerate: true,
          temporary: true,
          sandboxPreference,

          selectedModel,
        },
      });
    }
  };

  const handleRetry = async () => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    try {
      await handleRetryAttempt();
    } finally {
      retryInFlight.current = false;
    }
  };

  const handleEditMessage = async (
    messageId: string,
    newContent: string,
    remainingFileIds?: string[],
  ) => {
    setIsAutoResuming(false);

    // Stop any active stream first to prevent message order issues and wasted tokens
    if (!(await prepareReplacement())) return;

    // Find the edited message index to identify subsequent messages
    const editedMessageIndex = messages.findIndex((m) => m.id === messageId);

    if (editedMessageIndex !== -1) {
      // Get all subsequent messages (both user and assistant) that will be removed
      const subsequentMessages = messages.slice(editedMessageIndex + 1);
      const idsToClean = subsequentMessages.map((m) => m.id);

      // Also clean todos from the edited message itself if it's an assistant message
      const editedMessage = messages[editedMessageIndex];
      if (editedMessage.role === "assistant") {
        idsToClean.push(messageId);
      }

      // Remove todos linked to the edited message and all subsequent messages
      if (idsToClean.length > 0) {
        const updatedTodos = removeTodosBySourceMessages(todos, idsToClean);
        setTodos(updatedTodos);
      }
    }

    if (!temporaryChatsEnabled) {
      try {
        await regenerateWithNewContent({
          messageId: messageId as Id<"messages">,
          newContent,
          fileIds: remainingFileIds,
        });
      } catch (error) {
        // Swallow benign errors (e.g., racing edits where the message was already removed)
        // Avoid logging to keep console clean
      }
    }

    // Build updated parts: text + remaining file parts
    const buildUpdatedParts = (currentParts: any[]) => {
      const newParts: any[] = [];

      // Add text part if there's content
      if (newContent.trim()) {
        newParts.push({ type: "text", text: newContent });
      }

      // Keep file parts that are in remainingFileIds
      if (remainingFileIds && remainingFileIds.length > 0) {
        const remainingFileParts = currentParts.filter(
          (part) =>
            part.type === "file" &&
            part.fileId &&
            remainingFileIds.includes(part.fileId),
        );
        newParts.push(...remainingFileParts);
      }

      return newParts;
    };

    // Update local state to reflect the edit and remove subsequent messages
    setMessages((prevMessages) => {
      const editedMessageIndex = prevMessages.findIndex(
        (msg) => msg.id === messageId,
      );

      if (editedMessageIndex === -1) return prevMessages;

      const updatedMessages = prevMessages.slice(0, editedMessageIndex + 1);
      const currentMessage = updatedMessages[editedMessageIndex];
      updatedMessages[editedMessageIndex] = {
        ...currentMessage,
        parts: buildUpdatedParts(currentMessage.parts),
      };

      return updatedMessages;
    });

    // Trigger regeneration of assistant response with cleaned todos
    const cleanedTodosForEdit = (() => {
      const editedIndex = messages.findIndex((m) => m.id === messageId);
      if (editedIndex === -1) return todos;
      const subsequentMessages = messages.slice(editedIndex + 1);
      const idsToClean = subsequentMessages.map((m) => m.id);
      const editedMessage = messages[editedIndex];
      if (editedMessage.role === "assistant") idsToClean.push(messageId);
      return removeTodosBySourceMessages(todos, idsToClean);
    })();

    // For persisted chats, backend fetches from database
    // For temporary chats, send all messages up to and including the edited message
    if (!temporaryChatsEnabled) {
      regenerate({
        body: {
          mode: chatModeRef.current,
          messages: [],
          todos: cleanedTodosForEdit,
          regenerate: true,
          temporary: false,
          sandboxPreference,

          selectedModel,
        },
      });
    } else {
      // For temporary chats, send messages up to and including the edited message
      const messagesUpToEdit = messages.slice(0, editedMessageIndex + 1);
      const editedMessage = messages[editedMessageIndex];

      // Build updated parts for the edited message
      const updatedParts: any[] = [];
      if (newContent.trim()) {
        updatedParts.push({ type: "text", text: newContent });
      }
      if (remainingFileIds && remainingFileIds.length > 0) {
        const remainingFileParts = editedMessage.parts.filter(
          (part: any) =>
            part.type === "file" &&
            part.fileId &&
            remainingFileIds.includes(part.fileId),
        );
        updatedParts.push(...remainingFileParts);
      }

      messagesUpToEdit[editedMessageIndex] = {
        ...editedMessage,
        parts: updatedParts,
      };

      regenerate({
        body: {
          mode: chatModeRef.current,
          messages: messagesUpToEdit,
          todos: cleanedTodosForEdit,
          regenerate: true,
          temporary: true,
          sandboxPreference,

          selectedModel,
        },
      });
    }
  };

  const handleContinue = () => {
    if (status === "streaming") return;
    hasManuallyStoppedRef.current = false;
    sendMessage(
      { text: "continue", metadata: { isAutoContinue: true } },
      {
        body: {
          mode: chatModeRef.current,
          isAutoContinue: true,
          todos,
          temporary: temporaryChatsEnabled,
          sandboxPreference,
          selectedModel,
        },
      },
    );
  };

  const handleSendNow = async (messageId: string) => {
    if (isSendingNowRef.current) return;
    const attempt = claimQueuedMessage(messageId);
    if (!attempt) return;
    const message = attempt.message;
    isSendingNowRef.current = true;
    hasManuallyStoppedRef.current = false;
    let dispatched = false;
    try {
      setIsAutoResuming(false);
      await stopActiveStream();
      if (!attempt.isCurrent()) {
        attempt.restore();
        return;
      }
      dispatched = true;
      const sending = sendMessage(
        {
          id: message.id,
          role: "user",
          parts: [
            ...(message.files ?? []),
            { type: "text", text: message.text },
          ],
          metadata: { createdAt: message.timestamp },
        },
        {
          metadata: createDispatchReceiptMetadata(attempt),
          body: {
            mode: chatModeRef.current,
            todos,
            temporary: temporaryChatsEnabled,
            sandboxPreference,
            selectedModel,
            purpose: chatPurpose,
          },
        },
      );
      void Promise.resolve(sending).then(attempt.failed, attempt.failed);
    } catch {
      hasManuallyStoppedRef.current = true;
      if (dispatched) attempt.failed();
      else attempt.restore();
      toast.error("The queued message could not be sent", {
        description:
          "Check the conversation before trying again. Your queued message is saved.",
      });
    } finally {
      isSendingNowRef.current = false;
    }
  };

  return {
    handleSubmit,
    handleStop,
    handleRegenerate,
    handleRetry,
    handleEditMessage,
    handleSendNow,
    handleContinue,
  };
};
