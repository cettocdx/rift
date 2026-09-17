import { wrapLanguageModel, type LanguageModelUsage } from "ai";

type ProviderUsage = Awaited<
  ReturnType<ReturnType<typeof wrapLanguageModel>["doGenerate"]>
>["usage"];

function normalizeUsage(u: ProviderUsage): LanguageModelUsage {
  return {
    inputTokens: u.inputTokens.total,
    outputTokens: u.outputTokens.total,
    totalTokens:
      u.inputTokens.total !== undefined && u.outputTokens.total !== undefined
        ? u.inputTokens.total + u.outputTokens.total
        : undefined,
    inputTokenDetails: {
      noCacheTokens: u.inputTokens.noCache,
      cacheReadTokens: u.inputTokens.cacheRead,
      cacheWriteTokens: u.inputTokens.cacheWrite,
    },
    outputTokenDetails: {
      textTokens: u.outputTokens.text,
      reasoningTokens: u.outputTokens.reasoning,
    },
    raw: u.raw,
  };
}

export interface ProviderPromptSize {
  systemChars: number;
  userChars: number;
  assistantChars: number;
  toolResultChars: number;
  toolSchemaChars: number;
  messageCount: number;
  toolCount: number;
}

/** Serialized character volumes, NOT provider tokens or billable usage. */
export function measureProviderPrompt(
  params: Parameters<ReturnType<typeof wrapLanguageModel>["doGenerate"]>[0],
): ProviderPromptSize {
  const result: ProviderPromptSize = {
    systemChars: 0,
    userChars: 0,
    assistantChars: 0,
    toolResultChars: 0,
    toolSchemaChars: 0,
    messageCount: params.prompt.length,
    toolCount: params.tools?.length ?? 0,
  };
  for (const message of params.prompt) {
    const size = JSON.stringify(message.content)?.length ?? 0;
    if (message.role === "system") result.systemChars += size;
    else if (message.role === "user") result.userChars += size;
    else if (message.role === "assistant") result.assistantChars += size;
    else if (message.role === "tool") result.toolResultChars += size;
  }
  result.toolSchemaChars = JSON.stringify(params.tools ?? []).length;
  return result;
}

/** A model response finishes before its tools. Observe its receipt there so
 * Stop during a tool does not discard already reported model usage. */
export function observeProviderUsage(
  model: Parameters<typeof wrapLanguageModel>[0]["model"],
  record: (usage: LanguageModelUsage) => void | Promise<void>,
  onPrompt?: (size: ProviderPromptSize) => void,
) {
  const inspect = (
    params: Parameters<ReturnType<typeof wrapLanguageModel>["doGenerate"]>[0],
  ) => {
    if (!onPrompt) return;
    try {
      onPrompt(measureProviderPrompt(params));
    } catch {
      /* Diagnostics never block a model call. */
    }
  };
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ doGenerate, params }) => {
        inspect(params);
        const result = await doGenerate();
        await record(normalizeUsage(result.usage));
        return result;
      },
      wrapStream: async ({ doStream, params }) => {
        inspect(params);
        const result = await doStream();
        let recorded = false;
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              async transform(part, controller) {
                if (part.type === "finish" && !recorded) {
                  recorded = true;
                  await record(normalizeUsage(part.usage));
                }
                controller.enqueue(part);
              },
            }),
          ),
        };
      },
    },
  });
}
