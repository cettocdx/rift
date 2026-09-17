import type { LanguageModelUsage } from "ai";

/** Completed SDK steps remain available even when abort/error omits totalUsage. */
export function aggregateStreamUsage(
  steps: ReadonlyArray<{ usage: LanguageModelUsage }>,
): Record<string, unknown> | undefined {
  if (!steps.length) return undefined;
  const sum = (read: (usage: LanguageModelUsage) => number | undefined) => {
    const values = steps
      .map(({ usage }) => read(usage))
      .filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && value >= 0,
      );
    return values.length
      ? values.reduce((total, value) => total + value, 0)
      : undefined;
  };
  const costs = steps.map(({ usage }) => usage.raw?.cost);
  const completeCost = costs.every(
    (cost) => typeof cost === "number" && Number.isFinite(cost) && cost >= 0,
  );
  return {
    inputTokens: sum((u) => u.inputTokens),
    outputTokens: sum((u) => u.outputTokens),
    totalTokens: sum((u) => u.totalTokens),
    inputTokenDetails: {
      noCacheTokens: sum((u) => u.inputTokenDetails?.noCacheTokens),
      cacheReadTokens: sum((u) => u.inputTokenDetails?.cacheReadTokens),
      cacheWriteTokens: sum((u) => u.inputTokenDetails?.cacheWriteTokens),
    },
    outputTokenDetails: {
      textTokens: sum((u) => u.outputTokenDetails?.textTokens),
      reasoningTokens: sum(
        (u) => u.outputTokenDetails?.reasoningTokens ?? u.reasoningTokens,
      ),
    },
    ...(completeCost
      ? {
          raw: {
            cost: costs.reduce<number>(
              (total, cost) => total + (cost as number),
              0,
            ),
          },
        }
      : {}),
  };
}
