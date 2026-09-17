import { logUsageRecord } from "@/lib/db/actions";
import { calculateRawModelCostDollars } from "@/lib/rate-limit/token-bucket";
import type { ChatMode, RateLimitInfo, SubscriptionTier } from "@/types";

interface StepUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    reasoningTokens?: number;
  };
  /** Some providers report reasoning at the top level. */
  reasoningTokens?: number;
  raw?: { cost?: number };
}

type UnpricedTokensByModel = Map<string, { input: number; output: number }>;

export interface UsageCostRecord {
  model: string;
  type: "included" | "extra";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Recorded, not billed: whether output tokens already include these is
   *  provider-specific, and when raw.cost is present the provider's own total
   *  wins anyway. Surfaced so the estimate path can be audited per model. */
  reasoningTokens?: number;
  costDollars: number;
  modelCostDollars: number;
  nonModelCostDollars: number;
  costSource: "provider" | "token_estimate";
}

/**
 * Tracks accumulated token usage across stream steps and handles logging.
 * Shared between chat-handler.ts and agent-task.ts to avoid duplication.
 */
export class UsageTracker {
  inputTokens = 0;
  outputTokens = 0;
  totalTokens = 0;
  cacheReadTokens = 0;
  reasoningTokens = 0;
  cacheWriteTokens = 0;
  private incompleteCacheCoverage = false;
  providerCost = 0;
  /** Model-only cost from per-step usage.raw.cost (excludes tool/sandbox spend). Used to
   * decide whether the provider reported an authoritative model cost; zero is valid. Missing cost falls back
   * to token-based model cost calculation. */
  modelProviderCost = 0;
  private modelCostReported = false;
  private hasUnpricedModelStep = false;

  private pricedModelInputTokens = 0;
  private pricedModelOutputTokens = 0;
  private summaryProviderCost = 0;
  private summaryCostReported = false;
  private hasUnpricedSummary = false;
  private pricedSummaryInputTokens = 0;
  private pricedSummaryOutputTokens = 0;
  // Keep model attribution independently of the final selected-model label.
  // A fallback and the summaries retained from its primary leg can have
  // different rates. Grouping tokens avoids growing state for every step.
  private unpricedMainTokens: UnpricedTokensByModel = new Map();
  private unpricedSummaryTokens: UnpricedTokensByModel = new Map();

  /** Every observed main-model step has a finite receipt; zero is valid. */
  get hasModelProviderCost(): boolean {
    return this.modelCostReported && !this.hasUnpricedModelStep;
  }

  private get hasCompleteProviderCost(): boolean {
    return (
      (this.modelCostReported || this.summaryCostReported) &&
      !this.hasUnpricedModelStep &&
      !this.hasUnpricedSummary
    );
  }
  /** Costs from sandbox sessions and tool usage (always accurate, even on non-clean streams) */
  nonModelCost = 0;
  lastStepInputTokens = 0;
  /** Output tokens from summarization (not from assistant responses) */
  summarizationOutputTokens = 0;

  /**
   * Discard the model leg's accumulated usage before a fallback retry runs.
   * Keeps nonModelCost (sandbox/tool spend already incurred) and summarization
   * output tokens, so the final deduction only bills the fallback model.
   */
  resetModelLeg() {
    this.providerCost -= this.modelProviderCost;
    this.modelProviderCost = 0;
    this.modelCostReported = false;
    this.hasUnpricedModelStep = false;
    this.pricedModelInputTokens = 0;
    this.pricedModelOutputTokens = 0;
    this.pricedSummaryInputTokens = 0;
    this.unpricedMainTokens.clear();
    // Preserve the existing waiver: summary input is discarded, output stays.
    for (const tokens of this.unpricedSummaryTokens.values()) tokens.input = 0;
    this.reasoningTokens = 0;
    this.inputTokens = 0;
    // Preserve summarization's contribution to outputTokens so the
    // streamOutputTokens getter (outputTokens - summarizationOutputTokens)
    // never goes negative.
    this.outputTokens = this.summarizationOutputTokens;
    this.totalTokens = this.outputTokens;
    this.lastStepInputTokens = 0;
    this.cacheReadTokens = 0;
    this.cacheWriteTokens = 0;
    this.incompleteCacheCoverage = false;
  }

  private attributeUnpricedTokens(
    target: UnpricedTokensByModel,
    usage: StepUsage,
    modelName?: string,
  ) {
    // Legacy callers without a model still use computeCostDollars' fallback.
    if (!modelName) return;
    const tokens = target.get(modelName) ?? { input: 0, output: 0 };
    tokens.input += usage.inputTokens || 0;
    tokens.output += usage.outputTokens || 0;
    target.set(modelName, tokens);
  }

  private observeCacheCoverage(usage: StepUsage) {
    const input = usage.inputTokens;
    const cacheRead = usage.inputTokenDetails?.cacheReadTokens;
    const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens;
    const hasCacheReceipt =
      Number.isFinite(cacheRead) || Number.isFinite(cacheWrite);
    // Totals from a later step cannot repair a missing earlier denominator or
    // establish that an unreported cache count was zero. This is telemetry only.
    if (
      (hasCacheReceipt && (!Number.isFinite(input) || (input ?? 0) < 0)) ||
      ((input ?? 0) > 0 && !hasCacheReceipt) ||
      (cacheRead ?? 0) < 0 ||
      (cacheWrite ?? 0) < 0 ||
      (cacheRead ?? 0) > (input ?? 0)
    )
      this.incompleteCacheCoverage = true;
  }

  accumulateStep(usage: StepUsage, modelName?: string) {
    this.observeCacheCoverage(usage);
    this.inputTokens += usage.inputTokens || 0;
    this.outputTokens += usage.outputTokens || 0;
    this.totalTokens +=
      usage.totalTokens ?? (usage.inputTokens || 0) + (usage.outputTokens || 0);
    this.lastStepInputTokens = usage.inputTokens || 0;
    this.cacheReadTokens += usage.inputTokenDetails?.cacheReadTokens || 0;
    this.cacheWriteTokens += usage.inputTokenDetails?.cacheWriteTokens || 0;
    this.reasoningTokens +=
      usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens ?? 0;
    const stepCost = usage.raw?.cost;
    if (
      typeof stepCost === "number" &&
      Number.isFinite(stepCost) &&
      stepCost >= 0
    ) {
      this.pricedModelInputTokens += usage.inputTokens || 0;
      this.pricedModelOutputTokens += usage.outputTokens || 0;
      this.modelCostReported = true;
      this.providerCost += stepCost;
      this.modelProviderCost += stepCost;
    } else {
      this.hasUnpricedModelStep = true;
      this.attributeUnpricedTokens(this.unpricedMainTokens, usage, modelName);
    }
  }

  /** Accepted summary usage has its own receipt coverage, separate from response steps. */
  accumulateSummary(usage: StepUsage, modelName?: string) {
    this.observeCacheCoverage(usage);
    const input = usage.inputTokens || 0;
    const output = usage.outputTokens || 0;
    this.inputTokens += input;
    this.outputTokens += output;
    this.totalTokens += usage.totalTokens ?? input + output;
    this.summarizationOutputTokens += output;
    this.cacheReadTokens += usage.inputTokenDetails?.cacheReadTokens || 0;
    this.cacheWriteTokens += usage.inputTokenDetails?.cacheWriteTokens || 0;
    const cost = usage.raw?.cost;
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
      this.summaryCostReported = true;
      this.summaryProviderCost += cost;
      this.providerCost += cost;
      this.pricedSummaryInputTokens += input;
      this.pricedSummaryOutputTokens += output;
    } else {
      this.hasUnpricedSummary = true;
      this.attributeUnpricedTokens(
        this.unpricedSummaryTokens,
        usage,
        modelName,
      );
    }
  }

  /** Output tokens from the streamed response only (excludes summarization) */
  get streamOutputTokens(): number {
    return this.outputTokens - this.summarizationOutputTokens;
  }

  /** Whether any cache token data was reported by the provider */
  get hasCacheData(): boolean {
    return this.cacheReadTokens > 0 || this.cacheWriteTokens > 0;
  }

  /** Fraction of total input served from cache; absent/inconsistent coverage stays unknown. */
  get cacheHitRate(): number | null {
    if (
      this.incompleteCacheCoverage ||
      !this.hasCacheData ||
      this.inputTokens <= 0 ||
      this.cacheReadTokens > this.inputTokens
    )
      return null;
    return this.cacheReadTokens / this.inputTokens;
  }

  get hasUsage(): boolean {
    return (
      this.inputTokens > 0 ||
      this.outputTokens > 0 ||
      this.providerCost > 0 ||
      this.hasCompleteProviderCost
    );
  }

  computeModelCostDollars(selectedModel: string): number {
    // Preserve every receipt, including zero. Price known unpriced operations
    // at the model that ran them, then use the caller's model only for legacy
    // tokens with no attribution. Tool/sandbox dollars are added separately.
    let attributedInput = 0;
    let attributedOutput = 0;
    let attributedCost = 0;
    for (const groups of [
      this.unpricedMainTokens,
      this.unpricedSummaryTokens,
    ]) {
      for (const [model, tokens] of groups) {
        attributedInput += tokens.input;
        attributedOutput += tokens.output;
        attributedCost += calculateRawModelCostDollars(
          tokens.input,
          tokens.output,
          model,
        );
      }
    }
    return (
      this.modelProviderCost +
      this.summaryProviderCost +
      attributedCost +
      calculateRawModelCostDollars(
        Math.max(
          0,
          this.inputTokens -
            this.pricedModelInputTokens -
            this.pricedSummaryInputTokens -
            attributedInput,
        ),
        Math.max(
          0,
          this.outputTokens -
            this.pricedModelOutputTokens -
            this.pricedSummaryOutputTokens -
            attributedOutput,
        ),
        selectedModel,
      )
    );
  }

  computeCostDollars(selectedModel: string): number {
    return this.computeModelCostDollars(selectedModel) + this.nonModelCost;
  }

  resolveUsageType(rateLimitInfo: RateLimitInfo): "included" | "extra" {
    return rateLimitInfo.extraUsagePointsDeducted &&
      rateLimitInfo.extraUsagePointsDeducted > 0
      ? "extra"
      : "included";
  }

  resolveModelName({
    selectedModelOverride,
    responseModel,
    configuredModelId,
    selectedModel,
  }: {
    selectedModelOverride?: string | null;
    responseModel?: string;
    configuredModelId: string;
    selectedModel: string;
  }): string {
    if (!selectedModelOverride || selectedModelOverride === "auto") {
      return "auto";
    }
    return responseModel || configuredModelId || selectedModel;
  }

  createUsageCostRecord({
    selectedModel,
    selectedModelOverride,
    responseModel,
    configuredModelId,
    rateLimitInfo,
  }: {
    selectedModel: string;
    selectedModelOverride?: string | null;
    responseModel?: string;
    configuredModelId: string;
    rateLimitInfo: RateLimitInfo;
  }): UsageCostRecord {
    const model = this.resolveModelName({
      selectedModelOverride,
      responseModel,
      configuredModelId,
      selectedModel,
    });
    const modelCostDollars = this.computeModelCostDollars(selectedModel);
    return {
      model,
      type: this.resolveUsageType(rateLimitInfo),
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens || this.inputTokens + this.outputTokens,
      cacheReadTokens: this.cacheReadTokens || undefined,
      cacheWriteTokens: this.cacheWriteTokens || undefined,
      reasoningTokens: this.reasoningTokens || undefined,
      costDollars: modelCostDollars + this.nonModelCost,
      modelCostDollars,
      nonModelCostDollars: this.nonModelCost,
      costSource: this.hasCompleteProviderCost ? "provider" : "token_estimate",
    };
  }

  log(args: {
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
    selectedModel: string;
    selectedModelOverride?: string | null;
    responseModel?: string;
    configuredModelId: string;
    rateLimitInfo: RateLimitInfo;
  }) {
    const usage = this.createUsageCostRecord(args);
    logUsageRecord({
      userId: args.userId,
      organizationId: args.organizationId,
      chatId: args.chatId,
      endpoint: args.endpoint,
      mode: args.mode,
      subscription: args.subscription,
      model: usage.model,
      type: usage.type,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costDollars: usage.costDollars,
      modelCostDollars: usage.modelCostDollars,
      nonModelCostDollars: usage.nonModelCostDollars,
      costSource: usage.costSource,
    });
  }
}
