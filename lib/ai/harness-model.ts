import { streamText, type ToolSet, type ModelMessage } from "ai";
import {
  filterEmptyAssistantMessages,
  repairAnthropicModelMessagesWithTelemetry,
} from "@/lib/chat/compaction/prune-tool-outputs";

type PromptRepair = ReturnType<
  typeof repairAnthropicModelMessagesWithTelemetry
>;
export function prepareHarnessMessages(
  messages: ModelMessage[],
  anthropic: boolean,
  onRepair?: (repair: Exclude<PromptRepair, { action: "none" }>) => void,
): ModelMessage[] {
  const nonEmpty = filterEmptyAssistantMessages(messages);
  if (!anthropic) return nonEmpty;
  const repair = repairAnthropicModelMessagesWithTelemetry(nonEmpty);
  if (repair.action !== "none") onRepair?.(repair);
  return repair.messages as ModelMessage[];
}

export type HarnessModelRequest = Parameters<typeof streamText<ToolSet>>[0];

/**
 * Shared SDK execution boundary for durable app runs and local CLI steps.
 * The app supplies executing tools and durable lifecycle hooks; the CLI supplies
 * schemas only and commits/executes the returned step on the user's machine.
 * Keep stream lifecycle hooks here: AI SDK 6 ToolLoopAgent does not expose
 * onChunk/onAbort/onError, which the durable owner must observe.
 */
export function streamHarnessModel(request: HarnessModelRequest) {
  request.abortSignal?.throwIfAborted();
  return streamText({
    // Bound provider setup retries. Explicit execution-target limits win.
    maxRetries: 1,
    ...request,
  });
}
