import { NextResponse } from "next/server";

import { verifyRunToken } from "@/lib/llm-proxy/token";
import { prepareUpstreamRequest } from "@/lib/opencode/proxy-request";
import {
  createUsageTallyTransform,
  parseUsageFromJson,
  type ProxyUsage,
} from "@/lib/opencode/sse-usage";
import { resolveCostMicros } from "@/lib/opencode/proxy-cost";
import {
  getLeaseBySandbox,
  readRunUsage,
  recordProxyUsage,
  acquireInflight,
  releaseInflight,
} from "@/lib/opencode/run-lease";
import { buildProviderOptions } from "@/lib/api/chat-stream-helpers";
import { createRedisClient } from "@/lib/rate-limit/redis";
import {
  patchKimiReasoningToolCalls,
  sanitizeOpenRouterEncryptedReasoning,
} from "@/lib/ai/providers";
import { openrouterAttributionHeaders } from "@/lib/ai/openrouter-attribution";
import { readLimitedTextBody, RequestBodyTooLargeError } from "@/lib/api/read-limited-body";
import { PAID_MAX_OUTPUT_TOKENS } from "@/lib/rate-limit/free-config";
import { BUILD_MODELS, type ReasoningEffort } from "@/types/chat";

/**
 * OpenAI-compatible LLM proxy for the OpenCode Build engine.
 *
 * OpenCode runs inside the chat sandbox and is configured to call this route
 * instead of OpenRouter directly, so the OpenRouter key never enters the
 * sandbox. Every request is authenticated by a per-run HMAC token, authorized
 * by a live Redis lease, and cut off once the per-leg dollar ceiling is spent.
 * Usage is metered from OpenRouter's own `usage.cost` and is the single billing
 * source the driver feeds into UsageTracker.
 */

export const runtime = "nodejs";
export const maxDuration = 800;

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_INFLIGHT_PER_RUN = 4;
const MAX_REQUESTS_PER_RUN = 600;

function devTrustWithoutLease(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.LLM_PROXY_DEV_NO_LEASE === "1" &&
    createRedisClient() === null
  );
}

function openAiError(status: number, code: string, message: string, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type, code } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // Retired engine: opt-in is required even with a valid old run token.
  if (process.env.RIFT_LEGACY_LLM_PROXY_ENABLED !== "true") {
    return openAiError(410, "proxy_retired", "This legacy engine endpoint is retired.");
  }
  if (process.env.LLM_PROXY_DISABLED === "true") {
    return openAiError(503, "proxy_disabled", "The LLM proxy is disabled.", "server_error");
  }

  const claims = verifyRunToken(request.headers.get("authorization"));
  if (!claims) {
    return openAiError(401, "invalid_token", "Missing or invalid proxy token.", "authentication_error");
  }

  let lease = await getLeaseBySandbox(claims.sandboxId);
  if (!lease && devTrustWithoutLease()) {
    // Local development only: no Redis, so no lease can exist. Trust the
    // verified token and skip metering. Never active in production.
    lease = {
      ...claims,
      subscription: "dev",
      modelKey: "",
      ceilingDollars: Number(process.env.LLM_PROXY_DEV_CEILING_USD ?? "1"),
      serverBaseUrl: "",
      serverAuth: "",
      createdAt: Date.now(),
    };
  }
  if (!lease || lease.userId !== claims.userId || lease.runId !== claims.runId) {
    return openAiError(402, "run_inactive", "No active run lease for this token.", "insufficient_quota");
  }

  // Ceiling check before spending another dollar.
  const usageSoFar = await readRunUsage(lease.runId);
  if (usageSoFar.costDollars >= lease.ceilingDollars) {
    return openAiError(402, "budget_exhausted", "This run has reached its cost ceiling.", "insufficient_quota");
  }
  if (usageSoFar.requests >= MAX_REQUESTS_PER_RUN) {
    return openAiError(402, "request_cap", "This run has reached its request cap.", "insufficient_quota");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return openAiError(500, "no_upstream_key", "Proxy is not configured.", "server_error");
  }

  let raw: string;
  try {
    raw = await readLimitedTextBody(request, MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof RequestBodyTooLargeError) {
      return openAiError(413, "body_too_large", "Request body is too large.");
    }
    return openAiError(400, "read_failed", "Could not read the request body.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return openAiError(400, "invalid_json", "Request body is not valid JSON.");
  }

  const modelKey = (parsed as { model?: unknown })?.model;
  const buildModel = BUILD_MODELS.find((m) => m.providerKey === modelKey);
  const providerOptions = buildProviderOptions(
    buildModel?.capabilities.includes("reasoning") ?? true,
    lease.userId,
    typeof modelKey === "string" ? modelKey : undefined,
    "agent",
    { reasoningEffort: lease.reasoningEffort as ReasoningEffort | undefined },
  ).openrouter as Record<string, unknown>;

  const prepared = prepareUpstreamRequest({
    body: parsed,
    providerOptions,
    maxOutputTokens: PAID_MAX_OUTPUT_TOKENS,
  });
  if (!prepared.ok) {
    return openAiError(prepared.status, prepared.code, prepared.message);
  }

  // Provider-specific body repairs (shared with the legacy loop).
  const kimi = patchKimiReasoningToolCalls(prepared.body);
  const sanitized = sanitizeOpenRouterEncryptedReasoning(kimi.body);
  const upstreamBody = JSON.stringify(sanitized.body);

  const inflight = await acquireInflight(lease.runId);
  if (inflight > MAX_INFLIGHT_PER_RUN) {
    await releaseInflight(lease.runId);
    return openAiError(429, "too_many_inflight", "Too many concurrent requests for this run.", "rate_limit_error");
  }

  const record = (usage: ProxyUsage) => {
    recordProxyUsage(lease.runId, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cachedTokens,
      reasoningTokens: usage.reasoningTokens,
      costMicros: resolveCostMicros(usage, lease.modelKey || (typeof modelKey === "string" ? modelKey : "")),
    }).catch(() => {});
  };

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Experimental-Metadata": "enabled",
        ...openrouterAttributionHeaders,
      },
      body: upstreamBody,
      signal: request.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      await releaseInflight(lease.runId);
      return new Response(text || JSON.stringify({ error: { message: "Upstream error", code: "upstream_error" } }), {
        status: upstream.status,
        headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
      });
    }

    if (prepared.stream) {
      const tallied = upstream.body.pipeThrough(
        createUsageTallyTransform((usage) => {
          record(usage);
          releaseInflight(lease.runId).catch(() => {});
        }),
      );
      return new Response(tallied, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // Non-streaming.
    const json = await upstream.json();
    record(parseUsageFromJson(json));
    await releaseInflight(lease.runId);
    return NextResponse.json(json, { status: 200 });
  } catch (e) {
    await releaseInflight(lease.runId);
    const aborted = e instanceof Error && e.name === "AbortError";
    return openAiError(
      aborted ? 499 : 502,
      aborted ? "client_closed" : "upstream_fetch_failed",
      aborted ? "The request was aborted." : "Failed to reach the model provider.",
      "server_error",
    );
  }
}
