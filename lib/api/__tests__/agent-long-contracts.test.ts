/**
 * Structural contract tests for the three non-obvious agent-long reliability
 * invariants that are easy to break in a well-meaning refactor:
 *
 *   1. Transport reads the Trigger.dev "ui" stream directly and keeps a
 *      first-chunk timeout guard — prevents late stream discovery from turning
 *      live output into completion-time replay.
 *   2. Cancel compare-and-clear (expectedRunId) — TOCTOU guard preventing
 *      concurrent cancels from stomping each other's stored run ID.
 *   3. Resume 204 on observed terminal + retry on unverified 404 — preserves
 *      recovery handles without retaining observed terminal streams.
 *
 * Follows the pattern in chat-handler-pty-cleanup.test.ts: read source,
 * assert structural presence — no Trigger.dev SDK mocking required.
 */

import fs from "fs";
import path from "path";

const transportSrc = fs.readFileSync(
  path.resolve(__dirname, "../../chat/agent-long-transport.ts"),
  "utf8",
);

const cancelSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../app/api/agent-long/cancel/route.ts"),
  "utf8",
);

const taggedRunsSrc = fs.readFileSync(
  path.resolve(__dirname, "../agent-long-runs.ts"),
  "utf8",
);

const resumeSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../app/api/agent-long/resume/route.ts"),
  "utf8",
);

const routeSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../lib/api/agent-long-handler.ts"),
  "utf8",
);

const startupSrc = fs.readFileSync(
  path.resolve(__dirname, "../agent-long-startup.ts"),
  "utf8",
);

const taskSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../trigger/agent-long.ts"),
  "utf8",
);

const dbActionsSrc = fs.readFileSync(
  path.resolve(__dirname, "../../db/actions.ts"),
  "utf8",
);

const chatHandlersSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../app/hooks/useChatHandlers.ts"),
  "utf8",
);

const triggerConfigSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../trigger.config.ts"),
  "utf8",
);

const triggerSharedConfigSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../trigger.shared.ts"),
  "utf8",
);

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
};

describe("local Agent worker bootstrap", () => {
  test("starts Trigger.dev beside the Cursor development shell", () => {
    expect(packageJson.scripts?.["dev:cursor"]).toContain("trigger dev");
    expect(packageJson.scripts?.["dev:cursor"]).toContain(
      "--kill-others-on-fail",
    );
  });

  test("keeps Playwright's runtime BiDi mapper out of the Trigger bundle", () => {
    expect(packageJson.dependencies?.["chromium-bidi"]).toBe("16.0.1");
    expect(triggerConfigSrc).toContain(
      'import { createTriggerConfig } from "./trigger.shared"',
    );
    expect(triggerConfigSrc).toContain("export default createTriggerConfig({");
    expect(triggerSharedConfigSrc).toMatch(/"playwright-core"/);
    expect(triggerSharedConfigSrc).toMatch(/"chromium-bidi"/);
  });
});

describe("agent-long-transport — direct UI stream reader", () => {
  test("loads the browser-safe Trigger core client lazily and exposes an Agent-mode preloader", () => {
    expect(transportSrc).toMatch(/const getTriggerCore =/);
    expect(transportSrc).toMatch(/preloadAgentLongTransport/);
    expect(transportSrc).not.toMatch(
      /const triggerSdkPromise\s*=\s*import\("@trigger\.dev\/sdk"\)/,
    );
    expect(transportSrc).not.toMatch(/import\("@trigger\.dev\/sdk"\)/);
  });

  test("reads the Trigger.dev ui stream directly instead of using withStreams", () => {
    expect(transportSrc).toMatch(/apiClient\.fetchStream<unknown>\(/);
    expect(transportSrc).toMatch(/AGENT_UI_STREAM_ID/);
    expect(transportSrc).not.toMatch(/\.withStreams\(/);
  });

  test("Agent startup has bounded request and first-event recovery windows", () => {
    expect(transportSrc).toMatch(/AGENT_START_REQUEST_TIMEOUT_MS\s*=\s*35_000/);
    expect(transportSrc).toMatch(/AGENT_FIRST_EVENT_TIMEOUT_MS\s*=\s*60_000/);
    expect(transportSrc).toMatch(/STREAM_IDLE_TIMEOUT_SECONDS/);
  });

  test("failed run statuses abort the direct stream reader", () => {
    expect(transportSrc).toMatch(/apiClient\.subscribeToRun\(runId/);
    expect(transportSrc).toMatch(/TERMINAL_RUN_STATUSES\.has\(status\)/);
    expect(transportSrc).toMatch(/readAbortController\.abort\(\)/);
  });

  test("setTimeout aborts the stream reader and surfaces a retryable SSE error", () => {
    expect(transportSrc).toMatch(
      /startupTimeoutId = setTimeout\(\(\) => \{\s*readAbortController\.abort\(\);\s*sendStartupTimeoutAndClose\(\);\s*\}, firstEventTimeoutMs\)/,
    );
    // The clock is re-armable, and a live status event restarts it: a run
    // waiting behind the concurrency limit is not a dropped connection.
    expect(transportSrc).toMatch(
      /if \(!firstEventReceived\) armStartupTimeout\(\);/,
    );
    expect(transportSrc).toMatch(/AGENT_START_TIMEOUT_MESSAGE/);
  });

  test("producer failures are errors while real consumer cancellations remain aborts", () => {
    expect(transportSrc).toMatch(/type:\s*"error"/);
    expect(transportSrc).toMatch(/LOST_AGENT_CONNECTION_MESSAGE/);
    expect(transportSrc).toMatch(
      /if \(userAborted \|\| signal\?\.aborted\)[\s\S]*sendAbortAndClose\(\)[\s\S]*else[\s\S]*sendErrorAndClose\(\)/,
    );
  });

  test("clearTimeout is called after normal stream end", () => {
    expect(transportSrc).toMatch(/clearTimeout\(\s*timeoutId\s*\)/);
  });

  test("serializes SSE enqueue and consumer cancellation through one terminal guard", () => {
    expect(transportSrc).toMatch(/const enqueueFrame =/);
    expect(transportSrc).toMatch(/const markConsumerClosed =/);
    expect(transportSrc).toMatch(/cancel\(\)\s*{\s*cancelActiveStream\(\)/s);

    // The only raw enqueue belongs to enqueueFrame itself. Timers, status
    // monitoring, and stream iteration must all use the guarded helper.
    expect(transportSrc.match(/controller\.enqueue\(/g)).toHaveLength(1);
  });
});

describe("agent-long route — authenticated bounded body parsing", () => {
  test("authenticates before reading and parsing the message payload", () => {
    const authIdx = routeSrc.indexOf("await getUserIDAndPro(req)");
    const readIdx = routeSrc.indexOf("await readLimitedTextBody(");
    const parseIdx = routeSrc.indexOf("JSON.parse(rawBody)");

    expect(authIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(authIdx);
    expect(parseIdx).toBeGreaterThan(readIdx);
    expect(routeSrc).not.toMatch(/await req\.json\(\)/);
  });

  test("rejects oversized and non-object JSON before starting Trigger", () => {
    expect(routeSrc).toMatch(/MAX_AGENT_LONG_BODY_BYTES/);
    expect(routeSrc).toMatch(/RequestBodyTooLargeError/);
    expect(routeSrc).toMatch(/status:\s*413/);
    expect(routeSrc).toMatch(/Array\.isArray\(requestBody\)/);
  });
});

describe("agent-long cancel route — compare-and-clear idempotency", () => {
  test("the run is cancelled (and confirmed) before clearing the stored run ID", () => {
    // cancelRunAndConfirm now lives in lib/api/agent-long-runs.ts (the
    // agent-long route's one-run-per-chat guard needs it too); the cancel
    // route must call it, and only then clear the chat's stored run id.
    const postIdx = cancelSrc.indexOf("export async function POST");
    const cancelCallIdx = cancelSrc.indexOf("cancelRunAndConfirm(", postIdx);
    const clearCallIdx = cancelSrc.indexOf(
      "setActiveTriggerRun({",
      cancelCallIdx,
    );
    expect(cancelCallIdx).toBeGreaterThan(-1);
    expect(clearCallIdx).toBeGreaterThan(cancelCallIdx);
    const sharedSrc = fs.readFileSync(
      path.resolve(__dirname, "../agent-long-runs.ts"),
      "utf8",
    );
    expect(sharedSrc).toMatch(/runs\.cancel\(runId\)/);
  });

  test("setActiveTriggerRun receives expectedRunId to prevent TOCTOU race", () => {
    expect(cancelSrc).toMatch(/expectedRunId\s*:\s*runId/);
  });

  // The tag lookup now lives in lib/api/agent-long-runs.ts because the resume
  // route needs the same resolution — temporary chats have no stored run id in
  // either direction. It is the ownership check for two endpoints, so it is
  // pinned where it lives rather than copied into each caller, which is what
  // would let one of them drift.
  test("temporary cancellation resolves only authenticated, tag-matched runs", () => {
    expect(cancelSrc).toMatch(/getOwnedTaggedRunIds/);
    expect(cancelSrc).toMatch(/temporary\s*===\s*true/);
    expect(taggedRunsSrc).toMatch(/tag:\s*chatTag/);
    expect(taggedRunsSrc).toMatch(/run\.tags\.includes\(chatTag\)/);
    expect(taggedRunsSrc).toMatch(/run\.tags\.includes\(userTag\)/);
    expect(taggedRunsSrc).toMatch(/taskIdentifier:\s*"agent-long"/);
  });

  test("never returns a Trigger run id to the cancel caller", () => {
    expect(cancelSrc).not.toMatch(
      /NextResponse\.json\(\{\s*canceled:\s*true,\s*runId/,
    );
  });
});

describe("useChatHandlers — durable cancellation coverage", () => {
  test("does not exclude temporary chats and tells the cancel route their scope", () => {
    const predicateStart = chatHandlersSrc.indexOf(
      "const shouldCancelTriggerRun",
    );
    const cancelStart = chatHandlersSrc.indexOf(
      "const cancelTriggerRun",
      predicateStart,
    );
    const helperStart = chatHandlersSrc.indexOf(
      "const stopActiveStream",
      cancelStart,
    );
    const predicate = chatHandlersSrc.slice(predicateStart, cancelStart);
    const cancel = chatHandlersSrc.slice(cancelStart, helperStart);

    expect(predicate).not.toMatch(/!temporaryChatsEnabledRef\.current/);
    expect(cancel).toMatch(/temporary:\s*temporaryChatsEnabledRef\.current/);
  });

  test("awaits Trigger cancellation in the shared stop path used by send-now", () => {
    expect(chatHandlersSrc).toMatch(
      /const triggerCancellationPromise\s*=\s*cancelTriggerRun\(\)/,
    );
    expect(chatHandlersSrc).toMatch(/await triggerCancellationPromise/);
    const sendNowStart = chatHandlersSrc.indexOf("const handleSendNow");
    const returnStart = chatHandlersSrc.indexOf("return {", sendNowStart);
    const sendNowHandler = chatHandlersSrc.slice(sendNowStart, returnStart);
    expect(sendNowHandler).toMatch(/await stopActiveStream\(\)/);
    expect(sendNowHandler.indexOf("await stopActiveStream()")).toBeLessThan(
      sendNowHandler.indexOf("sendMessage("),
    );
  });

  test("manual Stop and stop-and-send both use the same awaited stop helper", () => {
    const stopStart = chatHandlersSrc.indexOf("const handleStop");
    const regenerateStart = chatHandlersSrc.indexOf("const handleRegenerate");
    const stopHandler = chatHandlersSrc.slice(stopStart, regenerateStart);
    expect(stopHandler).toMatch(/await stopActiveStream\(\)/);

    const stopAndSendStart = chatHandlersSrc.indexOf(
      'queueBehavior === "stop-and-send"',
    );
    const tokenCheckStart = chatHandlersSrc.indexOf(
      "const tokenCount",
      stopAndSendStart,
    );
    const stopAndSendBranch = chatHandlersSrc.slice(
      stopAndSendStart,
      tokenCheckStart,
    );
    expect(stopAndSendBranch).toMatch(/await stopActiveStream\(\)/);
  });

  test("regenerate cancels a disconnected durable run before replacement", () => {
    const regenerateStart = chatHandlersSrc.indexOf("const handleRegenerate");
    const retryStart = chatHandlersSrc.indexOf("const handleRetry");
    const regenerateHandler = chatHandlersSrc.slice(
      regenerateStart,
      retryStart,
    );

    const replacement = chatHandlersSrc.slice(
      chatHandlersSrc.indexOf("const prepareReplacement"),
      regenerateStart,
    );
    expect(replacement).toMatch(
      /if \(status === "streaming"\)[\s\S]*await stopActiveStream\(\{ skipSave: true \}\)[\s\S]*else[\s\S]*await cancelTriggerRun\(\)/,
    );
    expect(
      regenerateHandler.indexOf("await prepareReplacement()"),
    ).toBeLessThan(regenerateHandler.indexOf("regenerate({"));
  });
});

describe("agent-long resume route — 204 only on observed terminal", () => {
  test("returns 204 when stored run is in a terminal state", () => {
    const terminalCheckIdx = resumeSrc.indexOf(
      "TERMINAL_STATUSES.has(runStatus)",
    );
    expect(terminalCheckIdx).toBeGreaterThan(-1);

    const status204AfterCheck = resumeSrc.indexOf(
      "status: 204",
      terminalCheckIdx,
    );
    expect(status204AfterCheck).toBeGreaterThan(terminalCheckIdx);
  });

  // SDK 404 and transient failures are exercised through GET in
  // app/api/agent-long/resume/__tests__/route.test.ts.

  test("returns 204 when no active run ID is stored", () => {
    expect(resumeSrc).toMatch(/status:\s*204/);
  });
});

describe("agent-long task — Trigger.dev dashboard error visibility", () => {
  test("runs are triggered with filterable queued metadata and tags", () => {
    expect(routeSrc).toMatch(/tags:\s*triggerTags/);
    expect(routeSrc).toMatch(/metadata:\s*{/);
    expect(routeSrc).toMatch(/status:\s*"queued"/);
    expect(routeSrc).toMatch(/loginRequired:\s*false/);
  });

  test("persisted chats send a trimmed Trigger payload and retain attachment exceptions", () => {
    expect(routeSrc).toMatch(
      /const messagesForPayload\s*=\s*temporary\s*\|\|\s*localDesktopAttachmentsPrepared\s*\?\s*messagesForTrigger\s*:\s*\[\]/s,
    );
    expect(routeSrc).toMatch(/messages:\s*messagesForPayload/);
  });

  test("public token creation and active run persistence are overlapped with orphan cleanup", () => {
    expect(routeSrc).toMatch(/finalizeAgentLongStartup\s*\(\s*{/);
    expect(routeSrc).toMatch(/createPublicToken:\s*\(\)\s*=>/);
    expect(routeSrc).toMatch(/persistActiveRun:\s*async\s*\(\)\s*=>/);
    expect(routeSrc).toMatch(
      /cancelTriggeredRun:\s*\(\)\s*=>\s*cancelRunAndConfirm/,
    );
    expect(routeSrc).toMatch(
      /releaseCanceledAgentRunClaim\(\{[\s\S]*?claimId:\s*startClaimId,[\s\S]*?runId:\s*handle\.id/,
    );

    expect(startupSrc).toMatch(/await Promise\.allSettled\(\[/);
    const failureCheckIdx = startupSrc.indexOf(
      'tokenResult.status === "fulfilled"',
    );
    const cancelIdx = startupSrc.indexOf(
      "await cancelTriggeredRun()",
      failureCheckIdx,
    );
    const clearIdx = startupSrc.indexOf("await clearActiveRun()", cancelIdx);
    expect(cancelIdx).toBeGreaterThan(failureCheckIdx);
    expect(clearIdx).toBeGreaterThan(cancelIdx);
  });

  test("handled user rate limits are returned after the UI error chunk is flushed", () => {
    const waitIdx = taskSrc.indexOf("drainPipedTriggerMirror(triggerMirror)");
    const streamErrorIdx = taskSrc.indexOf("if (terminalStreamError)", waitIdx);
    const handledRateLimitIdx = taskSrc.indexOf(
      "isHandledUserRateLimitError(terminalStreamError)",
      streamErrorIdx,
    );
    const returnIdx = taskSrc.indexOf(
      "return { chatId, assistantMessageId }",
      handledRateLimitIdx,
    );
    expect(waitIdx).toBeGreaterThan(-1);
    expect(streamErrorIdx).toBeGreaterThan(waitIdx);
    expect(handledRateLimitIdx).toBeGreaterThan(streamErrorIdx);
    expect(returnIdx).toBeGreaterThan(handledRateLimitIdx);
  });

  test("non-rate-limit stream errors are still rethrown after the handled branch", () => {
    const streamErrorIdx = taskSrc.indexOf("if (terminalStreamError)");
    const handledRateLimitIdx = taskSrc.indexOf(
      "isHandledUserRateLimitError(terminalStreamError)",
      streamErrorIdx,
    );
    const throwIdx = taskSrc.indexOf(
      "throw terminalStreamError",
      handledRateLimitIdx,
    );
    expect(streamErrorIdx).toBeGreaterThan(-1);
    expect(handledRateLimitIdx).toBeGreaterThan(streamErrorIdx);
    expect(throwIdx).toBeGreaterThan(streamErrorIdx);
  });

  test("provider finishReason error fails the task after the UI stream drains", () => {
    const waitIdx = taskSrc.indexOf("drainPipedTriggerMirror(triggerMirror)");
    const terminalErrorIdx = taskSrc.indexOf(
      "getTerminalProviderStreamError(terminalAgentState)",
      waitIdx,
    );
    const throwIdx = taskSrc.indexOf(
      "throw terminalStreamError",
      terminalErrorIdx,
    );

    expect(waitIdx).toBeGreaterThan(-1);
    expect(terminalErrorIdx).toBeGreaterThan(waitIdx);
    expect(throwIdx).toBeGreaterThan(terminalErrorIdx);
  });

  test("drains Trigger.dev's returned mirror while waiting for upload", () => {
    expect(taskSrc).toMatch(/stream:\s*triggerMirror/);
    expect(taskSrc).toMatch(/drainPipedTriggerMirror\(triggerMirror\)/);
    expect(taskSrc).toMatch(/await Promise\.all\(\[/);
  });

  test("cancellation and outer catch check the live usage tracker before refunding", () => {
    const liveUsagePredicateIdx = taskSrc.indexOf(
      "const hasObservedUsage = () => !!observedUsageTracker?.hasUsage",
    );
    const cleanupMapIdx = taskSrc.indexOf(
      "runCleanupMap.set(ctx.run.id",
      liveUsagePredicateIdx,
    );
    const onCancelIdx = taskSrc.indexOf("onCancel: async");
    const cancelDispatchIdx = taskSrc.indexOf(
      "await cleanup.cancel()",
      onCancelIdx,
    );
    const boundCancelIdx = taskSrc.indexOf(
      "cancel: bindConvexClientScope(async () =>",
      cleanupMapIdx,
    );
    const cancelRefundGuardIdx = taskSrc.indexOf(
      "if (!hasObservedUsage())",
      boundCancelIdx,
    );
    const cancelRefundIdx = taskSrc.indexOf(
      "usageRefundTracker.refund()",
      cancelRefundGuardIdx,
    );
    const outerCatch = taskSrc.search(/^ {10}\} catch \(error\) \{/m);
    const catchRefundGuard = taskSrc.indexOf(
      "if (!hasObservedUsage())",
      outerCatch,
    );
    const catchRefund = taskSrc.indexOf(
      "usageRefundTracker.refund()",
      catchRefundGuard,
    );

    expect(liveUsagePredicateIdx).toBeGreaterThan(-1);
    expect(cleanupMapIdx).toBeGreaterThan(liveUsagePredicateIdx);
    expect(onCancelIdx).toBeGreaterThan(-1);
    expect(cancelDispatchIdx).toBeGreaterThan(onCancelIdx);
    expect(boundCancelIdx).toBeGreaterThan(cleanupMapIdx);
    expect(cancelRefundGuardIdx).toBeGreaterThan(boundCancelIdx);
    expect(cancelRefundIdx).toBeGreaterThan(cancelRefundGuardIdx);
    expect(outerCatch).toBeGreaterThan(cancelRefundIdx);
    expect(catchRefundGuard).toBeGreaterThan(outerCatch);
    expect(catchRefund).toBeGreaterThan(catchRefundGuard);
    expect(taskSrc).not.toMatch(/hasObservedUsage\s*=\s*hasObservedUsage/);
  });

  test("task catch records structured metadata for dashboard filtering", () => {
    expect(taskSrc).toMatch(/recordAgentLongFailureForDashboard/);
    expect(taskSrc).toMatch(/errorCategory/);
    expect(taskSrc).toMatch(/loginRequired/);
    expect(taskSrc).toMatch(/login_required/);
    expect(taskSrc).toMatch(/error_\$\{summary\.category\}/);
    expect(taskSrc).toMatch(/metadata\.flush\(\)/);
  });

  test("empty rehydrated history is classified separately from oversized input", () => {
    const emptyPromptIdx = dbActionsSrc.indexOf("chat_prompt_empty");
    const emptyMessageIdx = dbActionsSrc.indexOf(
      "No message content was found for this request",
      emptyPromptIdx,
    );
    const tooLargeIdx = dbActionsSrc.indexOf(
      "Your input (including any attached files) is too large",
      emptyMessageIdx,
    );

    expect(emptyPromptIdx).toBeGreaterThan(-1);
    expect(emptyMessageIdx).toBeGreaterThan(emptyPromptIdx);
    expect(tooLargeIdx).toBeGreaterThan(emptyMessageIdx);
    expect(dbActionsSrc).toMatch(/empty_prompt:\s*true/);
    expect(taskSrc).toMatch(/errorMetadata\?\.empty_prompt\s*===\s*true/);
    expect(taskSrc).toMatch(/"empty_prompt"/);
  });

  test("agent-long DB rehydrate failures are not swallowed when no payload messages exist", () => {
    const fetchFailedIdx = dbActionsSrc.indexOf("chat_history_fetch_failed");
    const zeroNewMessagesIdx = dbActionsSrc.indexOf(
      "newMessages.length === 0",
      fetchFailedIdx,
    );
    const rethrowIdx = dbActionsSrc.indexOf(
      'databaseError("messages.getMessagesPageForBackend"',
      zeroNewMessagesIdx,
    );

    expect(fetchFailedIdx).toBeGreaterThan(-1);
    expect(zeroNewMessagesIdx).toBeGreaterThan(fetchFailedIdx);
    expect(rethrowIdx).toBeGreaterThan(zeroNewMessagesIdx);
  });

  test("normal agent-long sends reject empty message payloads before triggering", () => {
    const guardIdx = routeSrc.indexOf("requestMessages.length === 0");
    const emptyPayloadIdx = routeSrc.indexOf(
      "agent_long_empty_message_payload_rejected",
    );
    const triggerIdx = routeSrc.indexOf("tasks.trigger", emptyPayloadIdx);

    expect(guardIdx).toBeGreaterThan(-1);
    expect(emptyPayloadIdx).toBeGreaterThan(guardIdx);
    expect(triggerIdx).toBeGreaterThan(emptyPayloadIdx);
  });
});

/*
 * The reconnect handle must not depend on the request that started the run.
 *
 * Reported symptom: "I give the agent a task, leave the page, and it stops."
 * It did not stop -- production runs of 20 and 50 minutes complete with no
 * browser attached. What broke was reattachment: `active_trigger_run_id` is
 * the only handle the client has for finding an in-flight run, and it was
 * written exclusively by /api/agent-long, in the request the user abandons.
 * Trigger accepts the run first and the mapping is written after, so leaving
 * in that window stranded a run that was already executing.
 *
 * These pin the two halves of the fix. Both are the kind of thing a tidy-up
 * would happily undo, and neither fails loudly at runtime when it regresses --
 * it just goes back to looking like the agent quit.
 */
describe("agent-long reattachment survives the starting request", () => {
  test("the task activates its own claim before user content or cleanup registration", () => {
    const scheduledBranchIdx = taskSrc.indexOf("if (payload.scheduledRun) {");
    const selfRegisterIdx = taskSrc.search(
      /const workerStart\s*=\s*await\s+measureSetup\("claim",\s*\(\)\s*=>\s*startClaimedAgentRunForWorker\(/,
    );
    expect(scheduledBranchIdx).toBeGreaterThan(-1);
    expect(selfRegisterIdx).toBeGreaterThan(scheduledBranchIdx);
    expect(
      taskSrc.indexOf("runCleanupMap.set(ctx.run.id", selfRegisterIdx),
    ).toBeGreaterThan(selfRegisterIdx);
    expect(
      taskSrc.indexOf("getUserCustomization(", selfRegisterIdx),
    ).toBeGreaterThan(selfRegisterIdx);
    const claimCallEnd = taskSrc.indexOf(
      "runCleanupMap.set(ctx.run.id",
      selfRegisterIdx,
    );
    expect(taskSrc.slice(selfRegisterIdx, claimCallEnd)).toMatch(
      /runId:\s*ctx\.run\.id,[\s\S]*startClaimId:\s*payload\.startClaimId/,
    );
  });

  test("a bookkeeping failure never cancels a run the client can still reach", () => {
    // A fulfilled token returns before any cancellation can be considered:
    // the client has what it needs, and the task owns the mapping now.
    const tokenOkIdx = startupSrc.indexOf(
      'if (tokenResult.status === "fulfilled")',
    );
    const cancelIdx = startupSrc.indexOf("await cancelTriggeredRun()");
    expect(tokenOkIdx).toBeGreaterThan(-1);
    expect(cancelIdx).toBeGreaterThan(tokenOkIdx);
    // ...and the only thing that reaches the cancel is a token failure.
    expect(startupSrc).toMatch(/startupError\s*=\s*tokenResult\.reason/);
  });

  test("resume falls back to server-written tags when no id is stored", () => {
    expect(resumeSrc).toMatch(/getOwnedTaggedRunIds/);
    // Gates first, one token mint last: an early mint inside a branch is how
    // this endpoint would start serving runs a check would have refused.
    const purposeIdx = resumeSrc.indexOf("assertHackWorkbenchPurposeRoute");
    const tagLookupIdx = resumeSrc.indexOf("getOwnedTaggedRunIds({");
    const mintIdx = resumeSrc.indexOf("auth.createPublicToken");
    expect(tagLookupIdx).toBeGreaterThan(purposeIdx);
    expect(mintIdx).toBeGreaterThan(tagLookupIdx);
    expect(resumeSrc.split("auth.createPublicToken").length - 1).toBe(1);
  });
});

/*
 * A tag-recovered run id must never be written back to the chat row.
 *
 * It reads as a free optimisation and it is a stuck-state bug: the task clears
 * its own mapping from inside its body (trigger/agent-long.ts finally) and only
 * then returns, so between that clear and Trigger marking the run terminal the
 * row reads null while runs.list still reports it ACTIVE. A resume landing in
 * that window would reinstate an id whose only clear has already run — the chat
 * then shows as streaming forever, and Stop cancels a dead run while the live
 * one keeps going.
 */
describe("agent-long resume — no mapping write on the tag path", () => {
  test("the only mapping writes in resume are compare-and-set clears", () => {
    const writes =
      resumeSrc.match(/setActiveTriggerRun\(\{[\s\S]*?\}\)/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write).toMatch(/triggerRunId:\s*null/);
      expect(write).toMatch(/expectedRunId/);
    }
  });
});

// Stop acknowledgement, observation deadlines and racing completion outcomes
// are exercised through the real helpers in agent-long-runs.test.ts.

/*
 * Wave 0 — measurement is wired, not merely available.
 *
 * Every piece here existed as a module before it was connected: a run status
 * mutation with zero callers, a wide event that only reached console.log, a
 * recorder that saw two tools. These pin the connections, because a connection
 * that quietly comes undone looks exactly like "nothing happened".
 */
describe("agent-long — telemetry and alerting are wired", () => {
  test("the loop's telemetry hooks are handed to the runner", () => {
    expect(taskSrc).toMatch(/createAgentRunTelemetry\(\{/);
    expect(taskSrc).toMatch(/telemetry: telemetryHooks,/);
  });

  test("every tool set is instrumented through createTools' last argument", () => {
    const toolsIndex = fs.readFileSync(
      path.resolve(__dirname, "../../ai/tools/index.ts"),
      "utf8",
    );
    expect(toolsIndex).toMatch(
      /onToolCall\?: \(event: ToolCallEvent\) => void/,
    );
    // Both the first build and every fallback rebuild go through the instrument.
    expect(toolsIndex).toMatch(/const tools = buildInstrumentedTools\(\);/);
    expect(toolsIndex).toMatch(/return buildInstrumentedTools\(\);/);
    expect(taskSrc).toMatch(/runTelemetry\.onToolCall\(event\)/);
  });

  test("the run record advances past starting and knows its model", () => {
    expect(taskSrc).toMatch(/markStatus\("running", "thinking"\)/);
    const startIdx = taskSrc.indexOf("startRunRecord({");
    const modelIdx = taskSrc.indexOf("model: selectedModel,", startIdx);
    const closeIdx = taskSrc.indexOf("});", startIdx);
    expect(modelIdx).toBeGreaterThan(startIdx);
    expect(modelIdx).toBeLessThan(closeIdx);
  });

  test("the model run closes through resolveRunOutcome with metrics, after a flush", () => {
    // Pre-model Stop has a separate no-usage terminal write. Keep this assertion
    // anchored to the existing model onFinish outcome, not the first file occurrence.
    const outcomeIdx = taskSrc.indexOf("resolveRunOutcome({");
    const finishIdx = taskSrc.indexOf("await finishRunRecord({", outcomeIdx);
    const flushIdx = taskSrc.lastIndexOf(
      "await runRecorder.flush();",
      finishIdx,
    );
    expect(outcomeIdx).toBeGreaterThan(-1);
    expect(flushIdx).toBeGreaterThan(outcomeIdx);
    expect(taskSrc.slice(finishIdx, finishIdx + 600)).toMatch(
      /status: outcome\.status/,
    );
    expect(taskSrc.slice(finishIdx, finishIdx + 600)).toMatch(
      /metrics: toMetricsRecord\(/,
    );
    // The old inline ternary that recorded loops and budget cutoffs as clean
    // completions is gone.
    expect(taskSrc).not.toMatch(
      /\? "completed_with_warnings"\s*:\s*"cancelled"/,
    );
  });

  test("a failed run posts an ops alert, filtered by the quiet list", () => {
    const taskDef = taskSrc.slice(
      taskSrc.indexOf("function createAgentLongTask<"),
    );
    expect(taskDef).toMatch(/onFailure: async \(/);
    expect(taskDef).toMatch(/shouldAlertOnFailure\(/);
    expect(taskDef).toMatch(/postOpsAlert\(/);
  });

  test("provider credit exhaustion is its own category everywhere it matters", () => {
    const errorUtils = fs.readFileSync(
      path.resolve(__dirname, "../../utils/error-utils.ts"),
      "utf8",
    );
    expect(errorUtils).toMatch(/"provider_credits_exhausted"/);
    // Classified BEFORE the generic 4xx bucket, or it is invisible.
    const creditsIdx = errorUtils.indexOf(
      'return "provider_credits_exhausted"',
    );
    const fourxxIdx = errorUtils.indexOf('return "provider_4xx"');
    expect(creditsIdx).toBeGreaterThan(-1);
    expect(creditsIdx).toBeLessThan(fourxxIdx);
    expect(taskSrc).toMatch(/provider_credits_exhausted/);
    const errorBox = fs.readFileSync(
      path.resolve(__dirname, "../../../app/components/MessageErrorState.tsx"),
      "utf8",
    );
    expect(errorBox).toMatch(/isProviderCreditsExhaustedMessage\(/);
    expect(errorBox).toMatch(/isProviderCreditsExhausted \? null :/);
  });
});

/*
 * Cost safety, wired.
 *
 * A balance-funded run used to have no mid-stream guard: the monthly monitor
 * was deliberately nulled for it, the true-up allowed debt, and Build's
 * auto-continue chained legs without limit. The monitor now exists for every
 * run, carries a per-run ceiling, and sees sandbox cost as it accrues.
 */
describe("agent-long — per-run cost ceiling", () => {
  test("the budget monitor is constructed unconditionally, with a ceiling", () => {
    expect(taskSrc).toMatch(/const budgetMonitor = new BudgetMonitor\(/);
    expect(taskSrc).not.toMatch(
      /effectiveBudgetSnapshot\s*\?\s*new BudgetMonitor/,
    );
    expect(taskSrc).toMatch(/runCeilingDollars: runCeiling\.ceilingDollars/);
    expect(taskSrc).toMatch(/resolveRunCostCeiling\(\{/);
  });

  test("the loop's cost check includes live sandbox cost", () => {
    expect(taskSrc).toMatch(/getLiveNonModelCost: getSandboxSessionCost,/);
    const runnerSrc = fs.readFileSync(
      path.resolve(__dirname, "../agent-stream-runner.ts"),
      "utf8",
    );
    expect(runnerSrc).toMatch(/ctx\.getLiveNonModelCost\?\.\(\) \?\? 0/);
    expect(runnerSrc).toMatch(/budgetMonitor\?\.checkAfterStep\(costTotal\)/);
  });
});

describe("agent-long — one model-independent harness", () => {
  test("all models use native tools, approvals and cancellation", () => {
    expect(taskSrc).not.toContain("@/lib/opencode/");
    expect(taskSrc).not.toContain("resolveBuildEngine");
    expect(taskSrc).toContain('metadata.set("engine", "rift")');
    expect(taskSrc).toContain(
      "return createAgentStream(modelName, streamCtx, state)",
    );
    expect(taskSrc).toContain("isApprovalStopped: approvalGate.isStopped");
    expect(taskSrc).toMatch(
      /approvalStopped:\s*approvalGate\.isStopped\?\.\(\) \?\? false/,
    );
    expect(taskSrc).toContain("resolveChatSandboxNamespace({");
  });
});

describe("agent-long — one run per chat, bounded per user", () => {
  const routeSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../lib/api/agent-long-handler.ts"),
    "utf8",
  );
  const cancelSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../app/api/agent-long/cancel/route.ts"),
    "utf8",
  );
  const runsSrc = fs.readFileSync(
    path.resolve(__dirname, "../agent-long-runs.ts"),
    "utf8",
  );

  // Active-run refusal and replacement ordering are exercised through POST in
  // app/api/agent-long/__tests__/route-ownership.test.ts. Do not require the
  // endpoint to contain an early cancellation branch: acquisition owns it.

  test("runs are keyed per user and the task queue caps concurrency", () => {
    expect(routeSrc).toMatch(/tags: triggerTags,\s*concurrencyKey: userId,/);
    expect(taskSrc).toMatch(
      /queue: \{ name: "agent-long", concurrencyLimit: 3 \}/,
    );
  });

  test("cancel-and-confirm lives in one place and both routes use it", () => {
    expect(runsSrc).toMatch(
      /export async function cancelRunAndConfirm\(runId: string\)/,
    );
    expect(runsSrc).toMatch(
      /finishRunRecord\(\{ runId, status: "cancelled", stopReason: "user" \}\)/,
    );
    expect(cancelSrc).toMatch(
      /cancelRunAndConfirm,?\s*\}? from "@\/lib\/api\/agent-long-runs"|cancelRunAndConfirm/,
    );
    expect(cancelSrc).not.toMatch(/const TERMINAL_RUN_STATUSES = new Set/);
  });
});

describe("agent-long — native web verification", () => {
  test("uses the gated native toolset directly", () => {
    expect(taskSrc).toContain('} = phaseTimer.measureSync("tools",');
    expect(taskSrc).toMatch(
      /streamCtx\.tools\s*=\s*toolFreeTurn\s*\?\s*\{\}\s*:\s*getToolsForModel\(modelName\)/,
    );
    expect(taskSrc).toContain(
      "const toolFreeTurn = standaloneGreeting || standaloneText;",
    );
    expect(taskSrc).not.toContain("createToolBridge");
  });
});

describe("agent-long — durable checkpoint wiring", () => {
  test("selects the request from rehydrated history because ordinary Trigger payload messages are empty", () => {
    expect(taskSrc).toMatch(
      /const requestMessage = \[\.\.\.messagesForProcessing\]/,
    );
    expect(taskSrc).not.toMatch(
      /const requestMessage = \[\.\.\.payload.messages\]/,
    );
    expect(taskSrc).toContain("requestMessageId: requestMessage.id");
    expect(taskSrc).toContain("onStepStarted: checkpointOwner");
    expect(taskSrc).toContain("saveAgentCheckpoint({");
  });
  test("persists recovered history with a transactional run fence before another stream", () => {
    const recovery = taskSrc.indexOf(
      "const recoveredMessage = projectCheckpointAssistantMessage",
    );
    const recoveredSave = taskSrc.indexOf("await saveMessage({", recovery);
    const stream = taskSrc.indexOf("const createStream = async", recovery);
    expect(recovery).toBeGreaterThan(0);
    expect(recoveredSave).toBeGreaterThan(recovery);
    expect(stream).toBeGreaterThan(recoveredSave);
    expect(taskSrc.slice(recoveredSave, stream)).toContain(
      "expectedTriggerRunId: ctx.run.id",
    );
  });
});
