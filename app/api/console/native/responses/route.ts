import { workspaceIdentity } from "@/lib/console/workspace-usage";
import { beginWorkspaceUsage } from "@/lib/console/workspace-usage-server";
import { nativeToolNamespaces } from "@/lib/ai/native-tool-namespaces";
import { NextRequest } from "next/server";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import { AccountCreditLifecycle } from "@/lib/billing/account-credit-lifecycle";
import { migratePaidPlanLedger } from "@/lib/billing/paid-ledger-migration";
import { calculateTokenCost } from "@/lib/rate-limit/token-bucket";
import {
  readLimitedTextBody,
  RequestBodyTooLargeError,
} from "@/lib/api/read-limited-body";
import { UsageTracker } from "@/lib/usage-tracker";
import { openrouterAttributionHeaders } from "@/lib/ai/openrouter-attribution";
import {
  nativeAccess,
  parseNativeRequest,
  nativeSSE,
  nativeTerminalUsage,
  NativeRequestError,
  NATIVE_BODY_LIMIT,
  NATIVE_RESPONSES_URL,
} from "@/lib/ai/native-responses";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  let identity;
  try {
    identity = await getUserIDAndPro(req);
  } catch {
    return new Response("Sign in with rift login.", { status: 401 });
  }
  try {
    await assertUserCanMakeCostIncurringRequest(identity.userId);
  } catch {
    return new Response("Account access is unavailable.", { status: 403 });
  }
  if (req.headers.has("content-encoding"))
    return new Response(
      "Native Responses requires an uncompressed request body.",
      { status: 415 },
    );
  let usageIdentity;
  try {
    usageIdentity = workspaceIdentity(req.headers);
  } catch {
    return new Response("Invalid RIFT usage identity.", { status: 400 });
  }
  let lifecycle: AccountCreditLifecycle | undefined;
  let snapshot:
    | ReturnType<AccountCreditLifecycle["captureTerminalUsage"]>
    | undefined;
  let attempts = 0;
  let acknowledged = false;
  const cancellation = new AbortController();
  const signal = AbortSignal.any([
    req.signal,
    cancellation.signal,
    AbortSignal.timeout(280_000),
  ]);
  const settle = async () => {
    if (acknowledged) return;
    if (!lifecycle || !snapshot || attempts >= 2)
      throw new Error("Unresolved billing");
    attempts++;
    let result;
    try {
      result = await lifecycle.settle(snapshot);
    } catch (error) {
      if (attempts >= 2 || lifecycle.inspect().phase !== "settlement_unknown")
        throw error;
      attempts++;
      result = await lifecycle.settle(snapshot);
    }
    acknowledged = true;
    if (result.state !== "settled" || result.receipt.debtPointsAdded > 0)
      throw new Error("Billing reconciliation required");
  };
  const reconcile = async (
    reason: "interrupted" | "provider_unavailable" | "missing_usage",
  ) => {
    if (!lifecycle) return;
    if (!lifecycle.inspect().dispatchGranted) {
      await lifecycle.closeBeforeUse();
      return;
    }
    snapshot ??= lifecycle.captureTerminalUsage({ status: "unknown", reason });
    await settle();
  };
  try {
    const { body, model, estimate } = parseNativeRequest(
      JSON.parse(await readLimitedTextBody(req, NATIVE_BODY_LIMIT)),
    );
    const wire = nativeToolNamespaces(body);
    const { subscription, key } = await nativeAccess(identity);
    const { userId, pricingMargin } = identity;
    lifecycle = AccountCreditLifecycle.forProductionConsole({
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
    if (
      usageIdentity &&
      !(await beginWorkspaceUsage(userId, usageIdentity, lifecycle.operationId))
    )
      return new Response(
        "This operation already exists. Read its usage receipt; do not replay it.",
        { status: 409 },
      );
    await migratePaidPlanLedger(userId, subscription);
    const receipt = await lifecycle.reserve();
    signal.throwIfAborted();
    await lifecycle.startUse();
    signal.throwIfAborted();
    // One dispatch only: no SDK retries, capacity recovery, caller URLs, or model fallbacks.
    const upstream = await fetch(NATIVE_RESPONSES_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        ...openrouterAttributionHeaders,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(wire.body),
      signal,
    });
    if (
      !upstream.ok ||
      !upstream.body ||
      !upstream.headers.get("content-type")?.includes("text/event-stream")
    ) {
      await upstream.body?.cancel().catch(() => undefined);
      await reconcile("provider_unavailable").catch(() => undefined);
      return new Response(
        upstream.status === 429
          ? "This model is temporarily busy. Retry explicitly when ready."
          : "Native model provider rejected this request.",
        { status: upstream.status === 429 ? 429 : 502 },
      );
    }
    const billing = lifecycle;
    const providerBody = upstream.body;
    let disconnected = false;
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          const emit = (event: unknown) => {
            if (!disconnected)
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
          };
          const heldTools: unknown[] = [];
          let heldBytes = 0;
          try {
            for await (const upstreamEvent of nativeSSE(providerBody)) {
              const event = wire.restore(upstreamEvent);
              signal.throwIfAborted();
              if (
                [
                  "error",
                  "response.failed",
                  "response.incomplete",
                  "response.cancelled",
                ].includes(event.type)
              )
                throw new Error("Provider did not complete");
              if (event.type !== "response.completed") {
                const item = event.item as { type?: unknown } | undefined;
                const itemEvent =
                  event.type === "response.output_item.added" ||
                  event.type === "response.output_item.done";
                if (
                  itemEvent &&
                  ![
                    "message",
                    "reasoning",
                    "function_call",
                    "custom_tool_call",
                  ].includes(String(item?.type))
                )
                  throw new Error("Unsupported provider output item");
                const executable =
                  (itemEvent &&
                    (item?.type === "function_call" ||
                      item?.type === "custom_tool_call")) ||
                  event.type.startsWith("response.function_call_arguments.") ||
                  event.type.startsWith("response.custom_tool_call_input.");
                if (executable) {
                  heldBytes += encoder.encode(JSON.stringify(event)).byteLength;
                  if (heldBytes > 8 * 1024 * 1024)
                    throw new Error("Tool event buffer exceeded");
                  heldTools.push(event);
                } else emit(event);
                continue;
              }
              const usage = nativeTerminalUsage(event, model.providerModel);
              if (!usage) {
                await reconcile("missing_usage");
                throw new Error("Missing usage");
              }
              snapshot = billing.captureTerminalUsage({
                status: "known",
                modelName: model.providerKey,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                modelProviderCostDollars: usage.cost,
                nonModelCostDollars: 0,
              });
              await settle();
              // Analytics is observational: never reopen a settled debit after a logging failure.
              try {
                const tracker = new UsageTracker();
                tracker.accumulateStep({
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  raw:
                    usage.cost === undefined ? undefined : { cost: usage.cost },
                });
                const resetTime = receipt.includedResetAt
                  ? new Date(receipt.includedResetAt)
                  : new Date();
                void Promise.resolve(
                  tracker.log({
                    userId,
                    // Shared analytics currently classifies all local model steps here.
                    endpoint: "/api/console/model",
                    mode: "agent",
                    subscription,
                    selectedModel: model.providerKey,
                    configuredModelId: model.providerModel,
                    rateLimitInfo: {
                      remaining: receipt.includedRemainingPoints,
                      limit: receipt.includedTotalPoints,
                      resetTime,
                      servedFrom: "account",
                      pricingMargin,
                    },
                  }),
                ).catch(() => undefined);
              } catch {
                /* Settled accounting does not depend on analytics. */
              }
              signal.throwIfAborted();
              for (const toolEvent of heldTools) emit(toolEvent);
              emit(event);
              // Completion is terminal. Cancel the upstream reader; duplicate terminals cannot bill or emit again.
              return;
            }
            throw new Error("Provider stream interrupted");
          } catch {
            await reconcile("interrupted").catch(() => undefined);
            emit({
              type: "error",
              code: "native_response_uncommitted",
              message:
                "Model response was not committed. Usage may require reconciliation; no automatic replay is safe.",
            });
          } finally {
            cancellation.abort();
            if (!disconnected) controller.close();
          }
        },
        cancel() {
          disconnected = true;
          cancellation.abort();
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        },
      },
    );
  } catch (error) {
    await reconcile("interrupted").catch(() => undefined);
    if (error instanceof NativeRequestError)
      return new Response(error.message, { status: error.status });
    if (error instanceof RequestBodyTooLargeError)
      return new Response("Native request body too large.", { status: 413 });
    if (error instanceof SyntaxError)
      return new Response("Invalid JSON request.", { status: 400 });
    return new Response(
      "Native model request could not start. Check account credits and access.",
      { status: 429 },
    );
  }
}
