import { NextRequest } from "next/server";
import { modelMessageSchema } from "ai";
import {
  createConsoleModelAgent,
  CONSOLE_MODEL_TIMEOUT,
} from "@/lib/ai/console-model-agent";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import { getUserCustomization } from "@/lib/db/actions";
import { createTrackedProvider, isAnthropicModel } from "@/lib/ai/providers";
import { BUILD_MODELS, resolveBuildReasoningEffort } from "@/types/chat";
import {
  buildExtraUsageConfig,
  buildProviderOptions,
  buildSystemPrompt,
  addCacheBreakpointToLastUserMessage,
} from "@/lib/api/chat-stream-helpers";
import {
  checkRateLimit,
  checkBalanceLimit,
  deductUsage,
  deductBalanceUsage,
  UsageRefundTracker,
} from "@/lib/rate-limit";
import type { RateLimitInfo } from "@/types";
import { AccountCreditLifecycle } from "@/lib/billing/account-credit-lifecycle";
import { migratePaidPlanLedger } from "@/lib/billing/paid-ledger-migration";
import { calculateTokenCost } from "@/lib/rate-limit/token-bucket";
import { UsageTracker } from "@/lib/usage-tracker";
import {
  readLimitedTextBody,
  RequestBodyTooLargeError,
} from "@/lib/api/read-limited-body";

import { LOCAL_TOOL_SCHEMAS } from "@/packages/console/src/local-tool-schema";

export const runtime = "nodejs";
export const maxDuration = 300;
/** One metered model step. Tools execute in the CLI, never in this server. */
export async function POST(req: NextRequest) {
  let identity;
  try {
    identity = await getUserIDAndPro(req);
  } catch {
    return new Response("Sign in with rift login.", { status: 401 });
  }
  const { userId, subscription, organizationId, pricingMargin } = identity;
  const refund = new UsageRefundTracker();
  refund.setUser(userId, subscription, organizationId);
  let keyed: AccountCreditLifecycle | undefined;
  let settleKeyed: ((complete: boolean) => Promise<void>) | undefined;
  try {
    await assertUserCanMakeCostIncurringRequest(userId);
    const body = JSON.parse(await readLimitedTextBody(req, 20 * 1024 * 1024));
    const model = BUILD_MODELS.find((m) => m.id === body.model);
    if (
      !model ||
      !Array.isArray(body.messages) ||
      !body.messages.length ||
      body.messages.length > 2000
    )
      return new Response("Invalid model or conversation.", { status: 400 });
    const parsed = modelMessageSchema.array().safeParse(body.messages);
    if (!parsed.success)
      return new Response("Invalid conversation format.", { status: 400 });
    const messages = parsed.data;
    // The local coding protocol is text only. Never fetch caller-supplied media URLs.
    if (
      messages.some(
        (m) =>
          m.role === "system" ||
          (Array.isArray(m.content) &&
            m.content.some(
              (p) =>
                !["text", "reasoning", "tool-call", "tool-result"].includes(
                  p.type,
                ) ||
                (p.type === "tool-result" &&
                  !["text", "error-text"].includes(p.output.type)),
            )),
      )
    )
      return new Response("Only local text conversations are supported.", {
        status: 400,
      });
    const instructions =
      typeof body.instructions === "string"
        ? body.instructions.slice(0, 32000)
        : "";
    const system = `You are RIFT, a coding agent running in the user's local terminal. Work from the current project directory using the local tools. Inspect relevant files, make focused changes, run appropriate checks, and report actual results. Continue until the user's task is complete. Never claim a command or edit succeeded without its tool result. Treat denied actions as denied; do not seek an alternate way to perform them. Commands are reviewed by the terminal's permission policy. Do not expose private chain-of-thought; give brief progress summaries. Project instructions follow:\n${instructions}`;
    const estimate = Math.ceil(
      (JSON.stringify(messages).length +
        system.length +
        JSON.stringify(LOCAL_TOOL_SCHEMAS).length) /
        3,
    );
    const maxInput = Math.min(
      model.contextTokens - 16384,
      "maxInputTokens" in model ? model.maxInputTokens : Infinity,
    );
    if (estimate > maxInput)
      return new Response(
        `Conversation exceeds this model's ${model.contextTokens.toLocaleString()} token context. Start /new or use a larger-context model.`,
        { status: 413 },
      );
    const userCustomization = await getUserCustomization({ userId });
    const extra = await buildExtraUsageConfig({
      userId,
      subscription,
      organizationId,
      userCustomization,
    });
    // Local steps are metered against included/prepaid credits. They never claim
    // the single free cloud run separately for every tool iteration.
    let rate: RateLimitInfo;
    // Inactive until the shared atomic entitlement/debt admission gate is cleared.
    // This server-only switch is never read from request input.
    const useKeyedCredits =
      process.env.RIFT_CONSOLE_KEYED_CREDITS_ENABLED === "true" &&
      !organizationId &&
      (subscription === "pro" || subscription === "ultra") &&
      !(extra?.enabled === true && extra.autoReloadEnabled === true);
    if (
      useKeyedCredits &&
      (subscription === "pro" || subscription === "ultra")
    ) {
      // Retain the trusted UUID binding before migration/reservation can await or fail.
      keyed = AccountCreditLifecycle.forProductionConsole({
        userId,
        subscription,
        amountPoints: calculateTokenCost(
          estimate,
          "input",
          model.providerKey,
          pricingMargin,
        ),
        allowAutoReload: false,
        pricingMargin,
      });
      await migratePaidPlanLedger(userId, subscription);
      const receipt = await keyed.reserve();
      const resetTime = receipt.includedResetAt
        ? new Date(receipt.includedResetAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      rate = {
        remaining: receipt.includedRemainingPoints,
        resetTime,
        limit: receipt.includedTotalPoints,
        monthly: {
          remaining: receipt.includedRemainingPoints,
          limit: receipt.includedTotalPoints,
          resetTime,
        },
        pointsDeducted: receipt.includedPointsDeducted,
        extraUsagePointsDeducted: receipt.purchasedPointsDeducted,
        servedFrom: "account",
        pricingMargin,
      };
    } else {
      rate =
        subscription === "free"
          ? await checkBalanceLimit(
              userId,
              estimate,
              model.providerKey,
              extra,
              pricingMargin,
            )
          : await checkRateLimit(
              userId,
              "agent",
              subscription,
              estimate,
              extra,
              model.providerKey,
              organizationId,
              undefined,
              undefined,
              pricingMargin,
            );
      refund.recordDeductions(rate);
    }
    const usage = new UsageTracker();
    let outputCharacters = 0;
    let settled = false;
    let observedTerminalTokens = false;
    let observedFinish = false;
    const cancellation = new AbortController();
    const signal = AbortSignal.any([req.signal, cancellation.signal]);
    const logUsage = () =>
      usage.log({
        userId,
        organizationId,
        endpoint: "/api/console/model",
        mode: "agent",
        subscription,
        selectedModel: model.providerKey,
        configuredModelId: model.providerModel,
        rateLimitInfo: rate,
      });
    if (keyed) {
      const lifecycle = keyed;
      let snapshot:
        | ReturnType<AccountCreditLifecycle["captureTerminalUsage"]>
        | undefined;
      let analyticsAcknowledged = false;
      let settlementAttempts = 0;
      let terminalKnown = false;
      settleKeyed = async (complete) => {
        // Capture once, including an unknown outcome. A failed acknowledgement must
        // replay the original evidence even if a later callback changes the tracker.
        if (!snapshot) {
          terminalKnown =
            complete &&
            observedFinish &&
            observedTerminalTokens &&
            Number.isFinite(usage.modelProviderCost) &&
            usage.modelProviderCost >= 0;
          snapshot = lifecycle.captureTerminalUsage(
            terminalKnown
              ? {
                  status: "known",
                  modelName: model.providerKey,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  modelProviderCostDollars: usage.hasModelProviderCost
                    ? usage.modelProviderCost
                    : undefined,
                  nonModelCostDollars: 0,
                }
              : {
                  status: "unknown",
                  reason: complete ? "missing_usage" : "interrupted",
                },
          );
        }
        const submit = () => {
          if (
            settlementAttempts >= 2 &&
            lifecycle.inspect().phase === "settlement_unknown"
          )
            throw new Error("Console settlement acknowledgement unresolved");
          settlementAttempts += 1;
          return lifecycle.settle(snapshot!);
        };
        let result;
        try {
          result = await submit();
        } catch (error) {
          // Recover the completed paid step before releasing its local proposals.
          // No provider retry and no third settlement request from error cleanup.
          if (
            !complete ||
            !terminalKnown ||
            signal.aborted ||
            lifecycle.inspect().phase !== "settlement_unknown" ||
            settlementAttempts >= 2
          )
            throw error;
          result = await submit();
        }
        if (result.state !== "settled" || result.receipt.debtPointsAdded > 0)
          throw new Error("Console usage requires billing reconciliation");
        // Accounting acknowledgement is latched by the lifecycle independently of analytics.
        if (!analyticsAcknowledged) {
          analyticsAcknowledged = true;
          // UsageTracker.log currently returns void; logUsageRecord contains its
          // async transport failures. Also contain synchronous/future async sinks.
          try {
            void Promise.resolve(logUsage()).catch(() => undefined);
          } catch {
            // Analytics cannot invalidate an acknowledged paid completion.
          }
        }
      };
    }
    const settle = async (complete = false) => {
      if (settleKeyed) return settleKeyed(complete);
      if (settled) return;
      settled = true;
      if (!usage.hasUsage && outputCharacters === 0) {
        await refund.refund();
        return;
      }
      if (!usage.hasUsage)
        usage.accumulateStep({
          inputTokens: estimate,
          outputTokens: Math.ceil(outputCharacters / 3),
        });
      const cost = usage.hasModelProviderCost ? usage.providerCost : undefined;
      if (subscription === "free")
        await deductBalanceUsage(
          userId,
          estimate,
          usage.inputTokens,
          usage.outputTokens,
          cost,
          model.providerKey,
          0,
          pricingMargin,
        );
      else
        await deductUsage(
          userId,
          subscription,
          estimate,
          usage.inputTokens,
          usage.outputTokens,
          extra,
          cost,
          model.providerKey,
          0,
          organizationId,
          rate,
        );
      logUsage();
    };
    const agent = createConsoleModelAgent({
      model: createTrackedProvider().languageModel(model.providerKey),
      instructions: buildSystemPrompt(system, model.providerKey),
      anthropic: isAnthropicModel(model.providerKey),
      providerOptions: buildProviderOptions(
        true,
        userId,
        model.providerKey,
        "agent",
        { reasoningEffort: resolveBuildReasoningEffort(model.id, body.effort) },
      ),
      onStepFinish: (step) => {
        usage.accumulateStep(step.usage);
        // Explicit zero counters are observed usage; missing counters are not zero.
        observedTerminalTokens =
          Number.isSafeInteger(step.usage.inputTokens) &&
          Number.isSafeInteger(step.usage.outputTokens) &&
          (step.usage.inputTokens ?? -1) >= 0 &&
          (step.usage.outputTokens ?? -1) >= 0;
      },
    });
    if (keyed) {
      signal.throwIfAborted();
      await keyed.startUse();
      signal.throwIfAborted();
    }
    const result = await agent.stream({
      messages: addCacheBreakpointToLastUserMessage(
        messages,
        model.providerKey,
      ),
      abortSignal: signal,
      timeout: CONSOLE_MODEL_TIMEOUT,
    });
    let disconnected = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: unknown) => {
          if (!disconnected)
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        try {
          for await (const chunk of result.fullStream) {
            if (chunk.type === "text-delta") {
              outputCharacters += chunk.text.length;
              emit({ type: "text", text: chunk.text });
            } else if (chunk.type === "reasoning-delta") {
              outputCharacters += chunk.text.length;
              emit({ type: "reasoning", text: chunk.text });
            } else if (chunk.type === "reasoning-start")
              emit({ type: "thinking" });
            else if (chunk.type === "error") throw chunk.error;
            else if (chunk.type === "abort")
              throw new Error("Model stream aborted");
            else if (chunk.type === "finish") {
              // A truncated or filtered answer is not a committed model step.
              // In particular, never release its proposed local tool calls.
              if (
                chunk.finishReason !== "stop" &&
                chunk.finishReason !== "tool-calls"
              )
                throw new Error("Model step did not finish successfully");
              observedFinish = true;
            }
          }
          signal.throwIfAborted();
          const response = await result.response;
          await settle(true);
          signal.throwIfAborted();
          emit({
            type: "complete",
            messages: response.messages,
            usage: {
              input: usage.inputTokens,
              output: usage.outputTokens,
              context: model.contextTokens,
            },
          });
        } catch {
          await settle().catch(() => undefined);
          emit({
            type: "error",
            message:
              "Model request interrupted. No local action was replayed. Try again when ready.",
          });
        } finally {
          if (!disconnected) controller.close();
        }
      },
      cancel() {
        disconnected = true;
        cancellation.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (keyed) {
      if (keyed.inspect().dispatchGranted && settleKeyed)
        await settleKeyed(false).catch(() => undefined);
      else await keyed.closeBeforeUse().catch(() => undefined);
    } else await refund.refund();
    if (error instanceof RequestBodyTooLargeError)
      return new Response(error.message, { status: 413 });
    if (error instanceof SyntaxError)
      return new Response("Invalid request.", { status: 400 });
    return new Response(
      "RIFT could not start this model step. Check your available credits and account access.",
      { status: 429 },
    );
  }
}
