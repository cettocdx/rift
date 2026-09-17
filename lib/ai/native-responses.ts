import "server-only";
import { z } from "zod";
import { BUILD_MODELS } from "@/types/chat";
import { getProviderContext } from "@/lib/ai/provider-context";
import { getUserCustomization } from "@/lib/db/actions";
import { buildExtraUsageConfig } from "@/lib/api/chat-stream-helpers";
import type { getUserIDAndPro } from "@/lib/auth/get-user-id";

// Explicit native allowlist; models and prices still come from the Build catalog.
export const NATIVE_MODELS = BUILD_MODELS.filter(
  (m) => m.id === "build-codex" || m.id === "build-astra",
);
const VERIFIED_OPENCODE_MODEL_IDS = new Set([
  "build-gemini",
  "build-max",
  "build-fable",
  "build-grok",
  "build-kimi",
  "build-glm",
  "build-hunyuan",
]);
export const OPENCODE_MODELS = BUILD_MODELS.filter((model) =>
  VERIFIED_OPENCODE_MODEL_IDS.has(model.id),
);
export const ACCEPTED_RESPONSES_MODELS = [...NATIVE_MODELS, ...OPENCODE_MODELS];
export const NATIVE_RESPONSES_URL = "https://openrouter.ai/api/v1/responses";
export const NATIVE_BODY_LIMIT = 20 * 1024 * 1024;
export class NativeRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export async function nativeAccess(
  identity: Awaited<ReturnType<typeof getUserIDAndPro>>,
) {
  const { userId, subscription, organizationId } = identity;
  if (
    process.env.RIFT_CONSOLE_KEYED_CREDITS_ENABLED !== "true" ||
    organizationId ||
    (subscription !== "pro" && subscription !== "ultra")
  )
    throw new NativeRequestError(
      "Native console requires supported personal keyed credits.",
      403,
    );
  const userCustomization = await getUserCustomization({ userId });
  const extra = await buildExtraUsageConfig({
    userId,
    subscription,
    organizationId,
    userCustomization,
  });
  if (extra?.enabled === true && extra.autoReloadEnabled === true)
    throw new NativeRequestError(
      "Native console does not yet support automatic credit reload.",
      403,
    );
  const key = getProviderContext().openrouterApiKey;
  if (!key)
    throw new NativeRequestError("Native model provider is unavailable.", 503);
  return { subscription, key };
}
const textPart = z.union([
  z.object({ type: z.literal("input_text"), text: z.string() }).strict(),
  z
    .object({
      type: z.literal("output_text"),
      text: z.string(),
      annotations: z.array(z.unknown()).optional(),
      logprobs: z.array(z.unknown()).optional(),
    })
    .strict(),
  z.object({ type: z.literal("refusal"), refusal: z.string() }).strict(),
]);
const inputItem = z.union([
  z
    .object({
      type: z.literal("message").optional(),
      role: z.enum(["user", "assistant", "system", "developer"]),
      content: z.union([z.string(), z.array(textPart)]),
      id: z.string().optional(),
      status: z.string().optional(),
      phase: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("reasoning"),
      id: z.string().optional(),
      encrypted_content: z.string().nullable().optional(),
      summary: z.array(
        z
          .object({ type: z.literal("summary_text"), text: z.string() })
          .strict(),
      ),
      content: z
        .array(
          z
            .object({ type: z.literal("reasoning_text"), text: z.string() })
            .strict(),
        )
        // Pinned Codex serializes absent reasoning content as null. The
        // provider receives omitted content; encrypted continuation is unchanged.
        .nullable()
        .optional()
        .transform((value) => value ?? undefined),
      status: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("function_call"),
      name: z.string(),
      namespace: z.string().min(1).max(128).optional(),
      arguments: z.string(),
      call_id: z.string(),
      id: z.string().optional(),
      status: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("custom_tool_call"),
      name: z.string(),
      namespace: z.string().min(1).max(128).optional(),
      input: z.string(),
      call_id: z.string(),
      id: z.string().optional(),
      status: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum(["function_call_output", "custom_tool_call_output"]),
      call_id: z.string(),
      output: z.union([z.string(), z.array(textPart)]),
      id: z.string().optional(),
      status: z.string().optional(),
    })
    .strict(),
]);
const tool = z.union([
  z
    .object({
      type: z.literal("function"),
      name: z.string().min(1).max(128),
      description: z.string().optional(),
      parameters: z.record(z.string(), z.unknown()).nullable().optional(),
      strict: z.boolean().nullable().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("custom"),
      name: z.string().min(1).max(128),
      description: z.string().optional(),
      format: z
        .union([
          z.object({ type: z.literal("text") }).strict(),
          z
            .object({
              type: z.literal("grammar"),
              syntax: z.enum(["lark", "regex"]),
              definition: z.string(),
            })
            .strict(),
        ])
        .optional(),
    })
    .strict(),
]);
const toolWithNamespace = z.union([
  tool,
  z
    .object({
      type: z.literal("namespace"),
      name: z.string().min(1).max(128),
      description: z.string().optional(),
      tools: z.array(tool).min(1).max(256),
    })
    .strict(),
]);
const requestSchema = z
  .object({
    model: z.string(),
    stream: z.literal(true),
    input: z.union([z.string().min(1), z.array(inputItem).min(1).max(2000)]),
    instructions: z.string().max(128000).optional(),
    tools: z.array(toolWithNamespace).max(256).optional(),
    tool_choice: z
      .union([
        z.enum(["auto", "none", "required"]),
        z
          .object({ type: z.enum(["function", "custom"]), name: z.string() })
          .strict(),
      ])
      .optional(),
    parallel_tool_calls: z.boolean().optional(),
    reasoning: z
      .object({
        effort: z.string().optional(),
        context: z.literal("all_turns").optional(),
        summary: z.enum(["auto", "concise", "detailed"]).optional(),
      })
      .strict()
      .optional(),
    include: z.array(z.literal("reasoning.encrypted_content")).optional(),
    store: z.literal(false).optional(),
    previous_response_id: z.null().optional(),
    max_output_tokens: z.number().int().min(1).max(16384).optional(),
    text: z
      .object({
        verbosity: z.enum(["low", "medium", "high"]).optional(),
        format: z
          .object({ type: z.literal("text") })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    prompt_cache_key: z.string().max(256).optional(),
    client_metadata: z
      .record(z.string().max(128), z.string().max(4096))
      .refine((value) => Object.keys(value).length <= 16)
      .optional(),
  })
  .strict();
export function parseNativeRequest(value: unknown) {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success)
    throw new NativeRequestError(
      "Unsupported native Responses request. Send text-only full history, local function/custom tools, and store:false.",
    );
  const body = parsed.data;
  const model = ACCEPTED_RESPONSES_MODELS.find((m) => m.id === body.model);
  if (
    !model ||
    (body.reasoning?.effort !== undefined &&
      !(model.reasoning.supportedEfforts as readonly string[]).includes(
        body.reasoning.effort,
      ))
  )
    throw new NativeRequestError("Invalid native model or reasoning effort.");
  const estimate = Math.ceil(JSON.stringify(body).length / 3);
  const configuredMaxInput =
    "maxInputTokens" in model ? model.maxInputTokens : undefined;
  const maxInput = Math.min(
    model.contextTokens - 16384,
    configuredMaxInput ?? model.contextTokens - 16384,
  );
  if (estimate > maxInput)
    throw new NativeRequestError(
      "Native conversation exceeds this model's context limit.",
      413,
    );
  return {
    model,
    estimate,
    body: {
      ...body,
      // Local correlation metadata is neither provider input nor billing authority.
      client_metadata: undefined,
      // Codex's all_turns mode is satisfied by the full input history above.
      // OpenRouter does not document this option; do not forward it or remove
      // encrypted items from the caller's stateless continuation.
      reasoning:
        body.reasoning === undefined
          ? undefined
          : {
              ...(body.reasoning.effort === undefined
                ? {}
                : { effort: body.reasoning.effort }),
              ...(body.reasoning.summary === undefined
                ? {}
                : { summary: body.reasoning.summary }),
            },
      model: model.providerModel,
      store: false,
      max_output_tokens: body.max_output_tokens ?? 16384,
      provider: { allow_fallbacks: false },
    },
  };
}

/** Bound incomplete frames as well as complete frames, including split CRLF/UTF-8. */
export async function* nativeSSE(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  const maxFrame = 8 * 1024 * 1024;
  let wireBytes = 0;
  let frames = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      wireBytes += value?.byteLength ?? 0;
      if (wireBytes > 32 * 1024 * 1024)
        throw new Error("Provider stream too large");
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        if (++frames > 50_000) throw new Error("Provider event limit exceeded");
        if (match.index > maxFrame) throw new Error("Provider frame too large");
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data || data === "[DONE]") continue;
        const event: unknown = JSON.parse(data);
        if (
          !event ||
          typeof event !== "object" ||
          !("type" in event) ||
          typeof event.type !== "string"
        )
          throw new Error("Invalid provider event");
        yield event as Record<string, unknown> & { type: string };
      }
      if (buffer.length > maxFrame) throw new Error("Provider frame too large");
      if (done) {
        if (buffer.trim()) throw new Error("Truncated provider frame");
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export function nativeTerminalUsage(
  event: Record<string, unknown>,
  providerModel: string,
) {
  const response = event.response as Record<string, unknown> | undefined;
  if (
    !response ||
    response.status !== "completed" ||
    response.error ||
    (response.model !== undefined && response.model !== providerModel)
  )
    return null;
  const usage = response.usage as Record<string, unknown> | undefined;
  if (
    !usage ||
    !Number.isSafeInteger(usage.input_tokens) ||
    !Number.isSafeInteger(usage.output_tokens) ||
    (usage.input_tokens as number) < 0 ||
    (usage.output_tokens as number) < 0
  )
    return null;
  if (
    usage.cost !== undefined &&
    (typeof usage.cost !== "number" ||
      !Number.isFinite(usage.cost) ||
      usage.cost < 0)
  )
    return null;
  return {
    inputTokens: usage.input_tokens as number,
    outputTokens: usage.output_tokens as number,
    cost: usage.cost as number | undefined,
  };
}
