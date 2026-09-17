import {
  jsonSchema,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolLoopAgentSettings,
  type ToolSet,
} from "ai";
import {
  streamHarnessModel,
  prepareHarnessMessages,
  type HarnessModelRequest,
} from "./harness-model";
import { LOCAL_TOOL_SCHEMAS } from "@/packages/console/src/local-tool-schema";

/** The SDK generates one step; the CLI owns local execution and approval. */
export function createConsoleModelAgent(options: {
  model: LanguageModel;
  instructions: HarnessModelRequest["system"];
  anthropic?: boolean;
  providerOptions: ToolLoopAgentSettings<never, ToolSet>["providerOptions"];
  onStepFinish: ToolLoopAgentSettings<never, ToolSet>["onStepFinish"];
}) {
  const { instructions, anthropic = false, ...settings } = options;
  const tools: ToolSet = Object.fromEntries(
    Object.entries(LOCAL_TOOL_SCHEMAS).map(([name, schema]) => [
      name,
      tool({
        description: schema.description,
        inputSchema: jsonSchema({
          type: "object",
          properties: schema.properties,
          required: [...schema.required],
          additionalProperties: false,
        }),
      }),
    ]),
  );
  return {
    tools,
    stream: async (
      call: Pick<HarnessModelRequest, "abortSignal" | "timeout"> &
        (
          | { messages: ModelMessage[]; prompt?: never }
          | { prompt: string | ModelMessage[]; messages?: never }
        ),
    ) =>
      streamHarnessModel({
        ...settings,
        system: instructions,
        abortSignal: call.abortSignal,
        timeout: call.timeout,
        ...(call.messages !== undefined
          ? { messages: prepareHarnessMessages(call.messages, anthropic) }
          : { prompt: call.prompt }),
        maxOutputTokens: 16384,
        maxRetries: 0,
        stopWhen: stepCountIs(1),
        // Schemas only: adding execute here would run a local action on the server.
        tools,
      }),
  };
}

// Leave time inside the route's 300 s deadline for usage reconciliation.
export const CONSOLE_MODEL_TIMEOUT = { totalMs: 270_000, chunkMs: 120_000 };
