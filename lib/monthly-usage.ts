export type MonthlyUsageLogLike = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  total_tokens: number;
};

export type MonthlyUsageMessageLike = {
  id?: string;
  model?: string;
  usage?: unknown;
  parts?: readonly unknown[];
};

export type MonthlyModelUsage = {
  model: string;
  requests: number;
  tokens: number;
};

export type MonthlySubagentUsage = {
  name: string;
  role: string | null;
  runs: number;
};

export type MonthlyUsageSummary = {
  hasUsage: boolean;
  requestCount: number;
  tokenSource: "usage_logs" | "messages" | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  toolOperations: number | null;
  imageOperations: number | null;
  videoOperations: number | null;
  models: MonthlyModelUsage[];
  subagents: MonthlySubagentUsage[] | null;
};

type ParsedMessageUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const asNonNegativeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const firstNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const number = asNonNegativeNumber(value);
    if (number !== null) return number;
  }
  return null;
};

const cleanModelName = (model: string): string =>
  model
    .replace(/^model-/, "")
    .replace(/^fallback-/, "")
    .replace(/-model$/, "")
    .replace(/^[a-z-]+\//, "")
    .replace(/-\d{8}$/, "");

const parseMessageUsage = (value: unknown): ParsedMessageUsage | null => {
  const usage = asRecord(value);
  if (!usage) return null;

  const inputDetails = asRecord(usage.inputTokenDetails);
  const outputDetails = asRecord(usage.outputTokenDetails);
  const inputTokens = firstNumber(usage.inputTokens, usage.input_tokens);
  const outputTokens = firstNumber(usage.outputTokens, usage.output_tokens);
  const totalTokens = firstNumber(usage.totalTokens, usage.total_tokens);
  const cacheReadTokens = firstNumber(
    inputDetails?.cacheReadTokens,
    usage.cacheReadTokens,
    usage.cache_read_tokens,
  );
  const cacheWriteTokens = firstNumber(
    inputDetails?.cacheWriteTokens,
    usage.cacheWriteTokens,
    usage.cache_write_tokens,
  );
  const reasoningTokens = firstNumber(
    outputDetails?.reasoningTokens,
    usage.reasoningTokens,
    usage.reasoning_tokens,
  );

  if (
    inputTokens === null &&
    outputTokens === null &&
    totalTokens === null &&
    cacheReadTokens === null &&
    cacheWriteTokens === null &&
    reasoningTokens === null
  ) {
    return null;
  }

  const resolvedInput = inputTokens ?? 0;
  const resolvedOutput = outputTokens ?? 0;
  return {
    inputTokens: resolvedInput,
    outputTokens: resolvedOutput,
    totalTokens: totalTokens ?? resolvedInput + resolvedOutput,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  };
};

const addModelUsage = (
  map: Map<string, MonthlyModelUsage>,
  rawModel: string | null,
  tokens: number,
) => {
  const model = cleanModelName(rawModel ?? "Unknown model") || "Unknown model";
  const current = map.get(model) ?? { model, requests: 0, tokens: 0 };
  current.requests += 1;
  current.tokens += tokens;
  map.set(model, current);
};

export const getUtcMonthRange = (
  now: number = Date.now(),
): { start: number; end: number } => {
  const date = new Date(now);
  return {
    start: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    end: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  };
};

/**
 * Aggregate only persisted provider usage and real message tool parts.
 * Missing provider fields remain null so the UI never invents token counts.
 */
export const aggregateMonthlyUsage = (
  logs: readonly MonthlyUsageLogLike[],
  messages: readonly MonthlyUsageMessageLike[],
): MonthlyUsageSummary => {
  const messageUsage = messages
    .map((message) => ({
      message,
      usage: parseMessageUsage(message.usage),
    }))
    .filter(
      (entry): entry is {
        message: MonthlyUsageMessageLike;
        usage: ParsedMessageUsage;
      } => entry.usage !== null,
    );
  const useLogs = logs.length > 0;
  const tokenRows = useLogs ? logs : messageUsage.map((entry) => entry.usage);
  const modelMap = new Map<string, MonthlyModelUsage>();

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let hasCacheReadData = false;
  let hasCacheWriteData = false;

  if (useLogs) {
    for (const log of logs) {
      inputTokens += asNonNegativeNumber(log.input_tokens) ?? 0;
      outputTokens += asNonNegativeNumber(log.output_tokens) ?? 0;
      totalTokens += asNonNegativeNumber(log.total_tokens) ?? 0;
      const cacheRead = asNonNegativeNumber(log.cache_read_tokens);
      const cacheWrite = asNonNegativeNumber(log.cache_write_tokens);
      if (cacheRead !== null) {
        hasCacheReadData = true;
        cacheReadTokens += cacheRead;
      }
      if (cacheWrite !== null) {
        hasCacheWriteData = true;
        cacheWriteTokens += cacheWrite;
      }
      addModelUsage(
        modelMap,
        asNonEmptyString(log.model),
        asNonNegativeNumber(log.total_tokens) ?? 0,
      );
    }
  } else {
    for (const entry of messageUsage) {
      inputTokens += entry.usage.inputTokens;
      outputTokens += entry.usage.outputTokens;
      totalTokens += entry.usage.totalTokens;
      if (entry.usage.cacheReadTokens !== null) {
        hasCacheReadData = true;
        cacheReadTokens += entry.usage.cacheReadTokens;
      }
      if (entry.usage.cacheWriteTokens !== null) {
        hasCacheWriteData = true;
        cacheWriteTokens += entry.usage.cacheWriteTokens;
      }
      addModelUsage(
        modelMap,
        asNonEmptyString(entry.message.model),
        entry.usage.totalTokens,
      );
    }
  }

  let reasoningTokens = 0;
  let hasReasoningData = false;
  for (const entry of messageUsage) {
    if (entry.usage.reasoningTokens !== null) {
      hasReasoningData = true;
      reasoningTokens += entry.usage.reasoningTokens;
    }
  }

  const messagesAvailable = messages.length > 0;
  const seenToolCalls = new Set<string>();
  const subagentMap = new Map<string, MonthlySubagentUsage>();
  let toolOperations = 0;
  let imageOperations = 0;
  let videoOperations = 0;

  messages.forEach((message, messageIndex) => {
    message.parts?.forEach((partValue, partIndex) => {
      const part = asRecord(partValue);
      const type = asNonEmptyString(part?.type);
      if (!part || !type?.startsWith("tool-")) return;

      const toolCallId =
        asNonEmptyString(part.toolCallId) ??
        `${message.id ?? `message-${messageIndex}`}:${partIndex}`;
      if (seenToolCalls.has(toolCallId)) return;
      seenToolCalls.add(toolCallId);
      toolOperations += 1;

      if (type === "tool-generate_image") imageOperations += 1;
      if (type === "tool-generate_video") videoOperations += 1;

      if (type === "tool-delegate_task") {
        const input = asRecord(part.input);
        const output = asRecord(part.output);
        const agent = asRecord(output?.agent);
        const name =
          asNonEmptyString(agent?.name) ??
          asNonEmptyString(input?.name) ??
          "Subagent";
        const role =
          asNonEmptyString(agent?.role) ?? asNonEmptyString(input?.role);
        const key = `${name.toLocaleLowerCase()}::${role ?? ""}`;
        const current = subagentMap.get(key) ?? { name, role, runs: 0 };
        current.runs += 1;
        subagentMap.set(key, current);
      }
    });
  });

  const requests = tokenRows.length;
  const models = Array.from(modelMap.values()).sort(
    (a, b) => b.tokens - a.tokens || b.requests - a.requests,
  );
  const subagents = messagesAvailable
    ? Array.from(subagentMap.values()).sort(
        (a, b) => b.runs - a.runs || a.name.localeCompare(b.name),
      )
    : null;

  return {
    hasUsage: requests > 0 || toolOperations > 0,
    requestCount: requests,
    tokenSource: useLogs
      ? "usage_logs"
      : messageUsage.length > 0
        ? "messages"
        : null,
    inputTokens: requests > 0 ? inputTokens : null,
    outputTokens: requests > 0 ? outputTokens : null,
    totalTokens: requests > 0 ? totalTokens : null,
    cacheReadTokens: hasCacheReadData ? cacheReadTokens : null,
    cacheWriteTokens: hasCacheWriteData ? cacheWriteTokens : null,
    reasoningTokens: hasReasoningData ? reasoningTokens : null,
    toolOperations: messagesAvailable ? toolOperations : null,
    imageOperations: messagesAvailable ? imageOperations : null,
    videoOperations: messagesAvailable ? videoOperations : null,
    models,
    subagents,
  };
};
