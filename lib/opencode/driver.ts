import type { UIMessageChunk } from "ai";

import type {
  AgentStreamContext,
  AgentStreamState,
} from "@/lib/api/agent-stream-runner";
import { accumulateChunksToMessage } from "@/lib/utils/accumulate-ui-chunks";
import {
  BUDGET_EXHAUSTION_FINISH_REASON,
  DOOM_LOOP_FINISH_REASON,
  PREEMPTIVE_TIMEOUT_FINISH_REASON,
} from "@/lib/chat/stop-conditions";
import {
  createEventTranslator,
  type StepFinishInfo,
} from "@/lib/opencode/event-translator";
import type { OpenCodeClient, OpenCodeEvent } from "@/lib/opencode/client";
import type { RunUsageTotals } from "@/lib/opencode/run-lease";
import type { ChatMessage } from "@/types";

/**
 * The OpenCode engine driver: a drop-in for `createAgentStream` for Build.
 *
 * It returns the same two members the trigger task uses from a `streamText`
 * result — `toUIMessageStream(opts)` and `usage` — and fills the same mutable
 * `AgentStreamState`, so everything downstream (heartbeat wrap, saveMessage,
 * billing, run records, auto-continue) is untouched. Inside, it subscribes to
 * OpenCode's `/event` stream, fires `prompt_async`, translates events into
 * UI chunks, answers permission prompts (which would otherwise block forever),
 * enforces the step cap / elapsed timeout / dollar ceiling by aborting the
 * session, and reconciles proxy-metered usage into the UsageTracker after each
 * step. Booting the server, creating the session and issuing the lease happen
 * in the wiring layer so this stays testable with a fake client.
 */

export interface OpenCodeRunContext {
  client: OpenCodeClient;
  sessionId: string;
  /** RIFT providerKey (the gateway model id). */
  modelKey: string;
  promptText: string;
  agent?: string;
  systemPreamble?: string;
  maxSteps: number;
  /** Proxy-metered cumulative usage for this run (Redis). Optional for tests/dev. */
  readUsage?: () => Promise<RunUsageTotals>;
  /** Raw tool snapshots (file bridge). */
  onToolSnapshot?: (
    snapshot: import("@/lib/opencode/tool-map").OpenCodeToolSnapshot,
  ) => void;
  /** Called once when the turn ends (bridge close). */
  onTurnEnd?: () => Promise<void> | void;
  /** Wave 0 tool telemetry sink. */
  onToolCall?: (event: {
    toolName: string;
    toolCallId: string;
    durationMs: number;
    ok: boolean;
    errorClass?: string;
  }) => void;
  /** Injected timers for tests. */
  eventIdleTimeoutMs?: number;
  abortSettleMs?: number;
}

interface UIStreamOptions {
  generateMessageId: () => string;
  sendReasoning?: boolean;
  messageMetadata?: (info: {
    part: { type: "start" | "finish" };
  }) => Record<string, unknown> | undefined;
  onFinish?: (info: {
    messages: ChatMessage[];
    isAborted: boolean;
  }) => Promise<void> | void;
}

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : {};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createOpenCodeStream(
  modelName: string,
  ctx: AgentStreamContext,
  state: AgentStreamState,
  oc: OpenCodeRunContext,
): Promise<{
  toUIMessageStream: (opts: UIStreamOptions) => ReadableStream<UIMessageChunk>;
  usage: Promise<Record<string, unknown> | undefined>;
}> {
  let resolveUsage!: (u: Record<string, unknown> | undefined) => void;
  const usage = new Promise<Record<string, unknown> | undefined>(
    (r) => (resolveUsage = r),
  );

  const toUIMessageStream = (
    opts: UIStreamOptions,
  ): ReadableStream<UIMessageChunk> => {
    const chunks: UIMessageChunk[] = [];
    const messageId = opts.generateMessageId();
    let stepCount = 0;
    let doomLoopAsks = 0;
    let isAborted = false;
    let sawTurnActivity = false;
    let finishReason: string | undefined = "stop";
    let lastProxy: RunUsageTotals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      requests: 0,
      costDollars: 0,
    };
    const evAbort = new AbortController();
    const eventIdleTimeoutMs = oc.eventIdleTimeoutMs ?? 30_000;
    const abortSettleMs = oc.abortSettleMs ?? 5_000;

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        const emit = (c: UIMessageChunk) => {
          chunks.push(c);
          controller.enqueue(c);
        };

        const abortSession = async (reason: string | undefined) => {
          if (reason !== undefined) finishReason = reason;
          try {
            await oc.client.abort(oc.sessionId);
          } catch {
            /* server may already be idle */
          }
        };

        const translator = createEventTranslator({
          sendReasoning: opts.sendReasoning ?? true,
          callbacks: {
            onToolCompleted: (i) =>
              oc.onToolCall?.({
                toolName: i.toolName,
                toolCallId: i.callID,
                durationMs: i.durationMs,
                ok: i.ok,
                errorClass: i.ok ? undefined : "tool_error",
              }),
            onStepFinish: (info) => void onStep(info),
            onToolSnapshot: (snap) => oc.onToolSnapshot?.(snap),
          },
        });

        let lastStepAt = ctx.streamStartTime;
        const onStep = async (info: StepFinishInfo) => {
          stepCount += 1;
          sawTurnActivity = true;
          // Usage: proxy-metered totals are authoritative; OpenCode's step tokens are the fallback.
          let delta = {
            inputTokens: info.tokens.input,
            outputTokens: info.tokens.output,
            totalTokens: info.tokens.input + info.tokens.output,
            inputTokenDetails: {
              cacheReadTokens: info.tokens.cache.read,
              cacheWriteTokens: info.tokens.cache.write,
            },
            outputTokenDetails: { reasoningTokens: info.tokens.reasoning },
            raw: {} as Record<string, unknown>,
          };
          if (oc.readUsage) {
            try {
              const now = await oc.readUsage();
              // Only trust the proxy tally once it has actually moved; with no
              // Redis (dev) it stays at zero and the step tokens must stand.
              const moved =
                now.requests > 0 || now.costDollars > 0 || now.inputTokens > 0;
              if (moved)
                delta = {
                  inputTokens: now.inputTokens - lastProxy.inputTokens,
                  outputTokens: now.outputTokens - lastProxy.outputTokens,
                  totalTokens:
                    now.inputTokens -
                    lastProxy.inputTokens +
                    (now.outputTokens - lastProxy.outputTokens),
                  inputTokenDetails: {
                    cacheReadTokens:
                      now.cacheReadTokens - lastProxy.cacheReadTokens,
                    cacheWriteTokens: 0,
                  },
                  outputTokenDetails: {
                    reasoningTokens:
                      now.reasoningTokens - lastProxy.reasoningTokens,
                  },
                  raw: { cost: now.costDollars - lastProxy.costDollars },
                };
              if (moved) lastProxy = now;
            } catch {
              /* Redis unavailable: token-estimate path */
            }
          }
          ctx.usageTracker.accumulateStep(delta);
          state.lastStepInputTokens = info.tokens.input;
          state.ctxUsage = {
            usedTokens: info.tokens.input + info.tokens.output,
            maxTokens: ctx.ctxMaxTokens,
          };
          state.streamUsage = {
            inputTokens: ctx.usageTracker.inputTokens,
            outputTokens: ctx.usageTracker.outputTokens,
            totalTokens: ctx.usageTracker.totalTokens,
          };

          const costTotal =
            ctx.usageTracker.computeCostDollars(modelName) +
            (ctx.getLiveNonModelCost?.() ?? 0);
          const nowMs = Date.now();
          ctx.telemetry?.onStepFinished?.({
            stepIndex: stepCount,
            finishReason: info.reason,
            inputTokens: delta.inputTokens,
            outputTokens: delta.outputTokens,
            reasoningTokens: delta.outputTokenDetails.reasoningTokens,
            cacheReadTokens: delta.inputTokenDetails.cacheReadTokens,
            cacheWriteTokens: delta.inputTokenDetails.cacheWriteTokens,
            costDeltaDollars:
              typeof delta.raw.cost === "number" ? delta.raw.cost : 0,
            costTotalDollars: costTotal,
            toolNames: [],
            stepGapMs: nowMs - lastStepAt,
            contextPct:
              ctx.ctxMaxTokens > 0 ? info.tokens.input / ctx.ctxMaxTokens : 0,
          });
          lastStepAt = nowMs;

          if (ctx.budgetMonitor?.checkAfterStep(costTotal) === "abort") {
            state.stoppedDueToBudgetExhaustion = true;
            await abortSession(BUDGET_EXHAUSTION_FINISH_REASON);
          } else if (stepCount >= oc.maxSteps) {
            await abortSession("tool-calls");
          }
        };

        const handleControl = async (
          ev: OpenCodeEvent,
        ): Promise<"continue" | "done"> => {
          const p = asObj(ev.properties);
          const sessionID =
            typeof p.sessionID === "string" ? p.sessionID : undefined;
          const mine = !sessionID || sessionID === oc.sessionId;
          if (ev.type.startsWith("message.") && mine) sawTurnActivity = true;

          if (ev.type === "permission.asked" && mine) {
            const id = String(p.id ?? "");
            if (p.permission === "doom_loop") {
              doomLoopAsks += 1;
              if (doomLoopAsks >= 2) {
                state.stoppedDueToDoomLoop = true;
                await oc.client
                  .replyPermission(
                    id,
                    "reject",
                    "Stopping: repeated identical calls.",
                  )
                  .catch(() => {});
                await abortSession(DOOM_LOOP_FINISH_REASON);
              } else {
                ctx.telemetry?.onPrepareStep?.({
                  stepIndex: stepCount,
                  durationMs: 0,
                  summarized: false,
                  loopSeverity: "warning",
                  loopToolNames: [],
                });
                await oc.client
                  .replyPermission(
                    id,
                    "reject",
                    "[LOOP DETECTED] You repeated the same call with identical arguments. Use the result you already have and move to the next step.",
                  )
                  .catch(() => {});
              }
            } else {
              await oc.client.replyPermission(id, "once").catch(() => {});
            }
            return "continue";
          }
          if (ev.type === "question.asked" && mine) {
            await oc.client.rejectQuestion(String(p.id ?? "")).catch(() => {});
            return "continue";
          }
          if (ev.type === "session.compacted" && mine) {
            ctx.telemetry?.onPrepareStep?.({
              stepIndex: stepCount,
              durationMs: 0,
              summarized: true,
              loopSeverity: "none",
              loopToolNames: [],
            });
            return "continue";
          }
          if (ev.type === "session.error" && mine) {
            state.providerError =
              p.error ?? new Error("OpenCode session error");
            finishReason = "error";
            emit({
              type: "error",
              errorText: String(
                asObj(p.error).message ?? "OpenCode session error",
              ),
            });
            return "done";
          }
          const idle =
            (ev.type === "session.status" && asObj(p.status).type === "idle") ||
            ev.type === "session.idle";
          if (idle && mine && sawTurnActivity) return "done";
          return "continue";
        };

        const run = async () => {
          const onUserAbort = () => {
            isAborted = true;
            void abortSession(undefined);
          };
          ctx.abortController.signal.addEventListener("abort", onUserAbort, {
            once: true,
          });

          const elapsedBudget =
            ctx.maxDurationMs - (Date.now() - ctx.streamStartTime);
          // Infinity passed to setTimeout overflows to 1ms in Node.
          const elapsedTimer = Number.isFinite(elapsedBudget)
            ? setTimeout(
                () => {
                  state.stoppedDueToElapsedTimeout = true;
                  void abortSession(PREEMPTIVE_TIMEOUT_FINISH_REASON);
                },
                Math.max(1_000, elapsedBudget),
              )
            : undefined;

          const events = oc.client.events(evAbort.signal);
          let firstChunkSeen = false;
          try {
            // Subscribe first (eager registration on the server), then prompt.
            const first = await events.next();
            if (first.done)
              throw new Error(
                "OpenCode event stream closed before the prompt was sent.",
              );
            emit({
              type: "start",
              messageId,
              messageMetadata: opts.messageMetadata?.({
                part: { type: "start" },
              }),
            } as UIMessageChunk);
            await oc.client.promptAsync(oc.sessionId, {
              parts: [{ type: "text", text: oc.promptText }],
              model: { providerID: "gateway", modelID: oc.modelKey },
              ...(oc.agent ? { agent: oc.agent } : {}),
              ...(oc.systemPreamble ? { system: oc.systemPreamble } : {}),
            });

            for (;;) {
              const next = await Promise.race([
                events.next(),
                sleep(eventIdleTimeoutMs).then(() => "timeout" as const),
              ]);
              if (next === "timeout") {
                // No frame (heartbeats included) for a while: treat the turn as lost.
                finishReason = finishReason === "stop" ? "error" : finishReason;
                state.providerError =
                  state.providerError ??
                  new Error("OpenCode event stream went silent.");
                break;
              }
              if (next.done) break;
              const ev = next.value;
              if (!firstChunkSeen) {
                firstChunkSeen = true;
                ctx.telemetry?.onFirstChunk?.({
                  firstChunkMs: Date.now() - ctx.streamStartTime,
                });
              }
              for (const c of translator.feed(ev)) emit(c);
              if ((await handleControl(ev)) === "done") break;
              if (isAborted) {
                // Give OpenCode a moment to flush the aborted step, then stop.
                const settle = Date.now() + abortSettleMs;
                while (Date.now() < settle) {
                  const n = await Promise.race([
                    events.next(),
                    sleep(250).then(() => null),
                  ]);
                  if (!n) continue;
                  if (n.done) break;
                  for (const c of translator.feed(n.value)) emit(c);
                  if ((await handleControl(n.value)) === "done") break;
                }
                break;
              }
            }
          } catch (err) {
            state.providerError = state.providerError ?? err;
            finishReason = "error";
            emit({
              type: "error",
              errorText: err instanceof Error ? err.message : String(err),
            });
          } finally {
            if (elapsedTimer !== undefined) clearTimeout(elapsedTimer);
            ctx.abortController.signal.removeEventListener(
              "abort",
              onUserAbort,
            );
            evAbort.abort();
            try {
              await oc.onTurnEnd?.();
            } catch {
              /* bridge close is best-effort */
            }
            for (const c of translator.finalize()) emit(c);
            if (isAborted && !state.stoppedDueToElapsedTimeout) {
              finishReason = undefined; // manual stop, matches legacy semantics
              emit({ type: "abort" } as UIMessageChunk);
            }
            state.streamFinishReason = finishReason;
            state.responseModel = state.responseModel ?? modelName;
            emit({
              type: "finish",
              finishReason,
              messageMetadata: opts.messageMetadata?.({
                part: { type: "finish" },
              }),
            } as UIMessageChunk);
            const message = accumulateChunksToMessage(chunks, messageId);
            try {
              await opts.onFinish?.({ messages: [message], isAborted });
            } finally {
              resolveUsage(state.streamUsage);
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          }
        };
        void run();
      },
      cancel() {
        evAbort.abort();
      },
    });
  };

  return { toUIMessageStream, usage };
}
