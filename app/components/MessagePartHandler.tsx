import { memo, useContext } from "react";
import { UIMessage } from "@ai-sdk/react";
import { MemoizedMarkdown } from "./MemoizedMarkdown";
import { FileToolsHandler } from "./tools/FileToolsHandler";
import { FileHandler } from "./tools/FileHandler";
import { DesktopAccessStatusHandler } from "./tools/DesktopAccessStatusHandler";
import { TerminalToolHandler } from "./tools/TerminalToolHandler";
import { HttpRequestToolHandler } from "./tools/HttpRequestToolHandler";
import { WebToolHandler } from "./tools/WebToolHandler";
import { VerifyAppToolHandler } from "./tools/VerifyAppToolHandler";
import { TodoToolHandler } from "./tools/TodoToolHandler";
import { SearchToolHandler } from "@/app/components/tools/SearchToolHandler";
import { PatchToolHandler } from "@/app/components/tools/PatchToolHandler";
import { NotesToolHandler } from "./tools/NotesToolHandler";
import { ProxyToolHandler } from "./tools/ProxyToolHandler";
import { GetTerminalFilesHandler } from "./tools/GetTerminalFilesHandler";
import { SummarizationHandler } from "./tools/SummarizationHandler";
import type { ChatStatus } from "@/types";
import type { FileDetails } from "@/types/file";
import { ReasoningHandler } from "./ReasoningHandler";
import {
  GeneratingImagePlaceholder,
  GeneratingVideoPlaceholder,
  ImageGenerationError,
  normalizeImageGenerationBrief,
  VideoGenerationError,
} from "./GeneratingImagePlaceholder";
import { ExposePreviewCard } from "./ExposePreviewCard";
import { FilePartRenderer } from "./FilePartRenderer";
import type { FilePart } from "@/types/file";
import { PlanQuestions, DockedQuestionContext } from "./PlanQuestions";
import { useDataStreamState } from "./DataStreamProvider";
import {
  findOpenQuestionsFence,
  findQuestionsBlock,
} from "@/lib/chat/plan-questions";
import { SkillDiscoveryToolHandler } from "./tools/SkillDiscoveryToolHandler";

/**
 * Render an assistant text part, upgrading a fenced questions block into
 * interactive option cards. Falls back to plain markdown when there's no block.
 * While the block is still streaming (no closing fence), the raw JSON is hidden
 * so the user never sees half-written machine payload.
 */
function AssistantText({
  text,
  isStreaming = false,
  questionPrefix,
  readOnly,
}: {
  text: string;
  isStreaming?: boolean;
  questionPrefix: string;
  readOnly: boolean;
}) {
  // Replayed history is not being typed, it is being remembered. Animating it
  // word by word made the whole transcript re-type itself every time the user
  // came back to a running chat. Reveal only what arrives after the replay
  // edge; before it, paint instantly.
  const { isReplaying } = useDataStreamState();
  const dockedQuestion = useContext(DockedQuestionContext);
  const revealWords = isStreaming && !isReplaying;
  const block = findQuestionsBlock(text);
  if (block) {
    const before = text.slice(0, block.start).trimEnd();
    const after = text.slice(block.end).trimStart();
    return (
      <>
        {before && (
          <MemoizedMarkdown
            content={before}
            revealWords={revealWords}
            presentationKey={`${questionPrefix}:body`}
          />
        )}
        {dockedQuestion !== `${questionPrefix}:${block.start}` && (
          <PlanQuestions data={block.data} readOnly={readOnly} />
        )}
        {after && (
          <MemoizedMarkdown
            content={after}
            revealWords={revealWords}
            presentationKey={`${questionPrefix}:after`}
          />
        )}
      </>
    );
  }
  // An unclosed questions fence: hide the half-written JSON ONLY while the
  // stream is still in flight. Once the message is done, an unclosed fence means
  // the block never completed (e.g. truncated) — render the raw text so the
  // message is never blank. (This is what made Fable's Plan-mode replies look
  // empty: reasoning models can end a turn mid-fence.)
  //
  // The partial body has to actually look like a questions payload before it is
  // hidden. Without that test, widening the accepted labels to include `json`
  // would blank any reply that is still streaming an ordinary JSON block.
  if (isStreaming) {
    const openAt = findOpenQuestionsFence(text);
    if (openAt !== null) {
      const before = text.slice(0, openAt).trimEnd();
      return before ? (
        <MemoizedMarkdown
          content={before}
          revealWords={revealWords}
          presentationKey={`${questionPrefix}:body`}
        />
      ) : null;
    }
  }
  return (
    <MemoizedMarkdown
      content={text}
      revealWords={revealWords}
      presentationKey={`${questionPrefix}:body`}
    />
  );
}

interface MessagePartHandlerProps {
  message: UIMessage;
  part: any;
  partIndex: number;
  status: ChatStatus;
  isLastMessage?: boolean;
  /** Pre-computed terminal output by toolCallId (from message level) to avoid per-handler filtering */
  terminalOutputByToolCallId?: Map<string, string>;
  /** File details from get_terminal_files tool (streamed progressively) */
  sharedFileDetails?: FileDetails[];
}

function getGeneratedMediaPart(
  output: unknown,
  sharedFileDetails: FileDetails[] | undefined,
  defaults: { name: string; mediaType: string },
): FilePart | null {
  if (!output || typeof output !== "object") return null;

  const result = output as {
    url?: unknown;
    fileId?: unknown;
    storageId?: unknown;
    name?: unknown;
    mediaType?: unknown;
  };
  const outputFileId =
    typeof result.fileId === "string" ? result.fileId : undefined;
  const outputStorageId =
    typeof result.storageId === "string" ? result.storageId : undefined;
  const persisted = sharedFileDetails?.find(
    (file) =>
      (outputFileId && file.fileId === outputFileId) ||
      (outputStorageId && file.storageId === outputStorageId),
  );
  const fileId = outputFileId ?? persisted?.fileId;
  const storageId = outputStorageId ?? persisted?.storageId;
  const url =
    typeof result.url === "string" ? result.url : (persisted?.url ?? undefined);

  if (!url && !fileId && !storageId) return null;

  return {
    url: url ?? undefined,
    fileId: fileId as FilePart["fileId"],
    storageId,
    name:
      typeof result.name === "string"
        ? result.name
        : (persisted?.name ?? defaults.name),
    mediaType:
      typeof result.mediaType === "string"
        ? result.mediaType
        : (persisted?.mediaType ?? defaults.mediaType),
  };
}

// Memoized user text component - avoids re-renders for unchanged text
const UserTextPart = memo(function UserTextPart({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap">{text}</div>;
});

// Deep equality check for tool inputs — avoids JSON.stringify overhead while
// correctly handling nested objects/arrays (e.g. tool-file edits, todo_write todos).
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  const isArrayA = Array.isArray(a);
  const isArrayB = Array.isArray(b);
  if (isArrayA !== isArrayB) return false;

  if (isArrayA) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

// Custom comparison for MessagePartHandler to minimize re-renders
function arePropsEqual(
  prevProps: MessagePartHandlerProps,
  nextProps: MessagePartHandlerProps,
): boolean {
  // Always re-render if status changes (streaming state)
  if (prevProps.status !== nextProps.status) return false;

  // Always re-render if isLastMessage changes
  if (prevProps.isLastMessage !== nextProps.isLastMessage) return false;

  // Shared file details change for get_terminal_files during streaming
  // Must be checked before the part reference check below, because the part
  // reference may be stable while new file metadata arrives via the stream.
  if (
    prevProps.part?.type === "tool-get_terminal_files" &&
    prevProps.sharedFileDetails !== nextProps.sharedFileDetails
  )
    return false;

  // Check part reference - if same reference, no changes
  if (prevProps.part === nextProps.part) return true;

  // Pre-computed terminal map reference change should re-render
  if (
    prevProps.terminalOutputByToolCallId !==
    nextProps.terminalOutputByToolCallId
  )
    return false;

  // For tool parts, compare state and output which change during streaming
  if (
    prevProps.part?.type?.startsWith("tool-") ||
    prevProps.part?.type?.startsWith("data-")
  ) {
    return (
      prevProps.part.state === nextProps.part.state &&
      prevProps.part.toolCallId === nextProps.part.toolCallId &&
      prevProps.part.output === nextProps.part.output &&
      // Tool input is an object — reference check first (fast path), then
      // shallow comparison so new objects with identical content don't re-render.
      (prevProps.part.input === nextProps.part.input ||
        deepEqual(prevProps.part.input, nextProps.part.input))
    );
  }

  // For text parts, compare text content
  if (prevProps.part?.type === "text") {
    return prevProps.part.text === nextProps.part.text;
  }

  // For reasoning, compare text
  if (prevProps.part?.type === "reasoning") {
    return (
      prevProps.part.text === nextProps.part.text &&
      prevProps.message.parts.length === nextProps.message.parts.length
    );
  }

  // Default: shallow compare part object
  return prevProps.part === nextProps.part;
}

export const MessagePartHandler = memo(function MessagePartHandler({
  message,
  part,
  partIndex,
  status,
  isLastMessage,
  terminalOutputByToolCallId,
  sharedFileDetails,
}: MessagePartHandlerProps) {
  // Main switch for different part types
  switch (part.type) {
    case "text": {
      const isUser = message.role === "user";
      const text = part.text ?? "";

      // For user messages, use memoized plain text component
      if (isUser) {
        return <UserTextPart text={text} />;
      }

      // For assistant messages, render markdown + any Plan-mode question cards.
      // Only the last message can be actively streaming.
      return (
        <AssistantText
          text={text}
          questionPrefix={`${message.id}:${partIndex}`}
          readOnly={!isLastMessage}
          isStreaming={status === "streaming" && !!isLastMessage}
        />
      );
    }

    case "reasoning":
      return (
        <ReasoningHandler
          message={message}
          partIndex={partIndex}
          status={status}
          isLastMessage={isLastMessage}
        />
      );

    case "data-summarization":
      return (
        <SummarizationHandler
          message={message}
          part={part}
          partIndex={partIndex}
        />
      );

    // Legacy file tools
    case "tool-read_file":
    case "tool-write_file":
    case "tool-delete_file":
    case "tool-search_replace":
    case "tool-multi_edit":
      return <FileToolsHandler message={message} part={part} status={status} />;

    case "tool-file":
      return <FileHandler part={part} status={status} />;

    case "tool-desktop_access_status":
    case "tool-desktop_screenshot":
    case "tool-desktop_computer_action":
      return (
        <DesktopAccessStatusHandler
          part={part}
          status={status}
          readOnly={!isLastMessage}
        />
      );

    case "tool-generate_image": {
      const imageInput =
        part.input && typeof part.input === "object" ? part.input : undefined;
      const imageBrief = normalizeImageGenerationBrief(imageInput?.brief);

      // Done: render the generated image from the tool output (durable URL, so
      // it persists across reload — unlike a transient UI file part).
      if (part.state === "output-available") {
        const out = part.output;
        const generatedImage = getGeneratedMediaPart(out, sharedFileDetails, {
          name: imageBrief ?? "Generated image",
          mediaType: "image/png",
        });
        if (generatedImage) {
          return (
            <FilePartRenderer
              part={
                {
                  ...generatedImage,
                  name: imageBrief ?? "Generated image",
                  aspectRatio: imageInput?.aspectRatio,
                } as FilePart
              }
              partIndex={partIndex}
              messageId={message.id}
              large
            />
          );
        }
        // Tool returned a structured failure (no key, blocked prompt, out of
        // credits, no image, etc.) — surface it instead of a stuck placeholder.
        const errorText =
          out && typeof out === "object" && typeof out.error === "string"
            ? out.error
            : "Please try again.";
        return <ImageGenerationError message={errorText} />;
      }
      if (part.state === "output-error") {
        return (
          <ImageGenerationError
            message={
              typeof part.errorText === "string" && part.errorText
                ? part.errorText
                : "Please try again."
            }
          />
        );
      }
      // Still generating (input-streaming / input-available).
      return (
        <GeneratingImagePlaceholder
          brief={imageBrief}
          aspectRatio={imageInput?.aspectRatio}
          state={part.state}
        />
      );
    }

    case "tool-generate_video": {
      const videoInput =
        part.input && typeof part.input === "object" ? part.input : undefined;
      const videoBrief = normalizeImageGenerationBrief(videoInput?.brief);

      if (part.state === "output-available") {
        const out = part.output;
        const generatedVideo = getGeneratedMediaPart(out, sharedFileDetails, {
          name: "RIFT generated video.mp4",
          mediaType: "video/mp4",
        });
        if (generatedVideo) {
          return (
            <FilePartRenderer
              part={generatedVideo}
              partIndex={partIndex}
              messageId={message.id}
              large
            />
          );
        }
        const errorText =
          out && typeof out === "object" && typeof out.error === "string"
            ? out.error
            : "Please try again.";
        return <VideoGenerationError message={errorText} />;
      }
      if (part.state === "output-error") {
        return (
          <VideoGenerationError
            message={
              typeof part.errorText === "string" && part.errorText
                ? part.errorText
                : "Please try again."
            }
          />
        );
      }
      return (
        <GeneratingVideoPlaceholder
          brief={videoBrief}
          aspectRatio={videoInput?.aspectRatio}
          state={part.state}
        />
      );
    }

    case "tool-expose_preview": {
      if (part.state === "output-available") {
        const out = part.output;
        const url =
          out && typeof out === "object" && typeof out.url === "string"
            ? out.url
            : undefined;
        const error =
          out && typeof out === "object" && typeof out.error === "string"
            ? out.error
            : undefined;
        return <ExposePreviewCard url={url} error={error} />;
      }
      if (part.state === "output-error") return null;
      return null;
    }

    case "tool-find_skills":
      return <SkillDiscoveryToolHandler part={part} status={status} />;

    case "tool-web_search":
    case "tool-open_url":
    case "tool-browse_url":
    case "tool-web": // Legacy tool
      return <WebToolHandler part={part} status={status} />;

    case "data-terminal":
    case "tool-shell":
    case "tool-run_terminal_cmd":
    case "tool-interact_terminal_session": {
      const effectiveToolCallId =
        (part as any).data?.toolCallId ?? part.toolCallId;
      const precomputedStreamingOutput = effectiveToolCallId
        ? terminalOutputByToolCallId?.get(effectiveToolCallId)
        : undefined;
      return (
        <TerminalToolHandler
          message={message}
          part={part}
          status={status}
          precomputedStreamingOutput={precomputedStreamingOutput}
        />
      );
    }

    // Legacy tool
    case "tool-http_request":
      return (
        <HttpRequestToolHandler message={message} part={part} status={status} />
      );

    case "tool-get_terminal_files":
      return (
        <GetTerminalFilesHandler
          part={part}
          status={status}
          sharedFileDetails={sharedFileDetails}
        />
      );

    case "tool-verify_app":
      return <VerifyAppToolHandler part={part} status={status} />;

    case "tool-todo_write":
      return <TodoToolHandler message={message} part={part} status={status} />;

    case "tool-search":
      return <SearchToolHandler part={part} status={status} />;

    case "tool-apply_patch":
      return <PatchToolHandler part={part} status={status} />;

    case "tool-create_note":
      return (
        <NotesToolHandler part={part} status={status} toolName="create_note" />
      );

    case "tool-list_notes":
      return (
        <NotesToolHandler part={part} status={status} toolName="list_notes" />
      );

    case "tool-update_note":
      return (
        <NotesToolHandler part={part} status={status} toolName="update_note" />
      );

    case "tool-delete_note":
      return (
        <NotesToolHandler part={part} status={status} toolName="delete_note" />
      );

    case "tool-list_requests":
      return (
        <ProxyToolHandler
          part={part}
          status={status}
          toolName="list_requests"
        />
      );
    case "tool-view_request":
      return (
        <ProxyToolHandler part={part} status={status} toolName="view_request" />
      );
    case "tool-send_request":
      return (
        <ProxyToolHandler part={part} status={status} toolName="send_request" />
      );
    case "tool-scope_rules":
      return (
        <ProxyToolHandler part={part} status={status} toolName="scope_rules" />
      );
    case "tool-list_sitemap":
      return (
        <ProxyToolHandler part={part} status={status} toolName="list_sitemap" />
      );
    case "tool-view_sitemap_entry":
      return (
        <ProxyToolHandler
          part={part}
          status={status}
          toolName="view_sitemap_entry"
        />
      );

    default:
      return null;
  }
}, arePropsEqual);
