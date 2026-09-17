#!/usr/bin/env node
// Local, authenticated, bounded live checks. Never reports credentials or unrelated tool payloads.
const {
  parseBenchmarkOptions,
  buildScenario,
  createObservation,
  collectBenchmarkChunk,
  evaluateScenario,
} = require("./startup-scenarios.cjs");
let options;
try {
  options = parseBenchmarkOptions(process.argv.slice(2));
} catch (error) {
  console.error(`Invalid benchmark options: ${error.message}`);
  process.exit(1);
}
if (options.help) {
  console.log(
    "Usage: node scripts/benchmark-agent-startup.cjs [--scenario greeting|explanation|terminal|mixed] [--samples 1..20] [--persisted] [--disconnect] [--origin URL] [--model NAME] [--output FILE]\nLegacy soak: --terminal-soak --samples 1 [--soak-steps 1..120]. Mixed rotates three scenarios within the total sample limit.",
  );
  process.exit(0);
}
const {
  count,
  output,
  terminalSoak,
  persisted,
  soakSteps,
  disconnect,
  origin,
  selectedModel,
  scenarioNames,
} = options;
const { performance } = require("node:perf_hooks");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env.local"),
  quiet: true,
});
const { runs } = require("@trigger.dev/sdk");
const { ApiClient } = require("@trigger.dev/core/v3");
const { timingStats: stats } = require("./harness-quality.cjs");
const {
  startupTimingEvidence,
  setupPhaseTimingEvidence,
} = require("./startup-timing-evidence.cjs");
const { evaluateTerminalSoak } = require("./terminal-soak-evidence.cjs");
const { cleanupEvidence } = require("./cleanup-evidence.cjs");
const soakDeadlineSeconds = soakSteps * 10 + 180;
const soakCommand = `i=0; while [ "$i" -lt ${soakSteps} ]; do printf 'RIFT_SOAK_%s\\n' "$i"; i=$((i + 1)); sleep 10; done`;
const soakPrompt = `Run this one read-only terminal continuity check exactly once using run_terminal_cmd in foreground noninteractive mode, with a timeout of at least ${soakSteps * 10 + 30} seconds. Pass this command exactly, without modification:\n${soakCommand}\nUse the shell directly, not an interpreter. Do not create or edit files, browse, delegate, or use media tools. Wait for the command to finish and report RIFT_SOAK_DONE only if it exited successfully and reached RIFT_SOAK_${soakSteps - 1}. If interrupted, report the actual failure without rerunning it.`;
const config = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".config/rift/console.json"), "utf8"),
);
const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${config.apiKey}`,
};
const terminal = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
  "EXPIRED",
]);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function sample(index) {
  const start = Date.now();
  const observationStart = performance.now();
  const chatId = crypto.randomUUID();
  const scenario = buildScenario(
    scenarioNames[(index - 1) % scenarioNames.length],
    chatId,
  );
  const response = await fetch(`${origin}/api/agent-long`, {
    method: "POST",
    signal: AbortSignal.timeout(35000),
    headers: authHeaders,
    body: JSON.stringify({
      chatId,
      temporary: !persisted,
      purpose: "app",
      selectedModel,
      reasoningEffort: "medium",
      approvalMode: terminalSoak ? "full" : scenario.approvalMode,
      ...(scenario.sandboxPreference
        ? { sandboxPreference: scenario.sandboxPreference }
        : {}),
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [
            { type: "text", text: terminalSoak ? soakPrompt : scenario.prompt },
          ],
        },
      ],
    }),
  });
  if (!response.ok)
    return {
      index,
      scenario: terminalSoak ? "terminal-soak" : scenario.name,
      status: `HTTP_${response.status}`,
      totalMs: Date.now() - start,
    };
  const { runId, publicAccessToken } = await response.json();
  if (!runId || !publicAccessToken) throw new Error("Missing run handle");
  // Retain a non-secret handle immediately: an observer timeout must not make
  // an admitted long task invisible or cause the probe to start it twice.
  console.log(JSON.stringify({ index, runId, chatId, stage: "admitted" }));
  let tokenLifetimeHours, tokenRunScoped;
  try {
    const claims = JSON.parse(
      Buffer.from(publicAccessToken.split(".")[1], "base64url").toString(
        "utf8",
      ),
    );
    tokenLifetimeHours =
      typeof claims.exp === "number" && typeof claims.iat === "number"
        ? (claims.exp - claims.iat) / 3600
        : undefined;
    tokenRunScoped =
      Array.isArray(claims.scopes) &&
      claims.scopes.length === 1 &&
      claims.scopes[0] === `read:runs:${runId}`;
  } catch {
    /* Opaque tokens can still be used; never log their contents. */
  }
  const admissionMs = Date.now() - start;
  const routeTimings = Object.fromEntries(
    (response.headers.get("server-timing") ?? "").split(",").flatMap((part) => {
      const match = part.trim().match(/^([a-zA-Z]+);dur=(\d+)$/);
      return match ? [[match[1], Number(match[2])]] : [];
    }),
  );
  const api = new ApiClient("https://api.trigger.dev", publicAccessToken);
  let firstEventMs,
    firstTextMs,
    lastEventId,
    finished = false,
    detached = false,
    completedWhileDetached = false;
  let toolStarted = false,
    soakOutput = "",
    toolOutputConfirmed = false;
  const terminalCalls = [],
    terminalOutputs = [];
  const observation = createObservation();
  const ids = new Set();
  let duplicateEvents = 0;
  const read = async () => {
    const ctrl = new AbortController();
    const timeout = setTimeout(
      () => ctrl.abort(),
      terminalSoak ? soakDeadlineSeconds * 1000 : 60000,
    );
    try {
      const stream = await api.fetchStream(runId, "ui", {
        signal: ctrl.signal,
        timeoutInSeconds: 60,
        lastEventId,
        onPart(part) {
          if (part.id) {
            if (ids.has(part.id)) duplicateEvents++;
            ids.add(part.id);
            lastEventId = part.id;
          }
        },
      });
      for await (const chunk of stream) {
        collectBenchmarkChunk(
          observation,
          chunk,
          Math.round(performance.now() - observationStart),
        );
        firstEventMs ??= Date.now() - start;
        if (
          chunk.type === "tool-input-available" &&
          /terminal|exec|command/i.test(chunk.toolName ?? "")
        ) {
          toolStarted = true;
          terminalCalls.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input,
          });
        }
        if (chunk.type === "text-delta") soakOutput += chunk.delta ?? "";
        if (
          chunk.type === "tool-output-available" &&
          JSON.stringify(chunk.output).includes(`RIFT_SOAK_${soakSteps - 1}`)
        )
          toolOutputConfirmed = true;
        if (chunk.type === "tool-output-available")
          terminalOutputs.push({
            toolCallId: chunk.toolCallId,
            output: chunk.output,
          });
        if (chunk.type === "text-delta" && chunk.delta?.trim())
          firstTextMs ??= Date.now() - start;
        if (chunk.type === "finish") {
          finished = true;
          break;
        }
        if (chunk.type === "error" || chunk.type === "abort") break;
        if (disconnect && !detached && (!terminalSoak || toolStarted)) {
          detached = true;
          break;
        }
      }
    } finally {
      clearTimeout(timeout);
      ctrl.abort();
    }
  };
  await read();
  let run;
  if (disconnect && detached) {
    for (let i = 0; i < (terminalSoak ? soakDeadlineSeconds : 60); i++) {
      run = await runs.retrieve(runId);
      if (terminal.has(run.status)) break;
      await delay(1000);
    }
    completedWhileDetached = run?.status === "COMPLETED";
    await read();
  }
  for (let i = 0; i < 15; i++) {
    run = await runs.retrieve(runId);
    if (terminal.has(run.status)) break;
    await delay(500);
  }
  const meta = run?.metadata ?? {};
  const soakEvidence = evaluateTerminalSoak({
    calls: terminalCalls,
    outputs: terminalOutputs,
    steps: soakSteps,
    command: soakCommand,
  });
  const scenarioEvidence = evaluateScenario({
    scenario,
    observation,
    status: run?.status,
  });
  const setup = Object.fromEntries(
    Object.entries(meta.setupTimingsMs ?? {}).filter(
      ([, v]) => typeof v === "number",
    ),
  );
  const billing = meta.billingReservation;
  // Retain only the bounded routing evidence, never copy arbitrary metadata.
  const billingReservation =
    billing &&
    [
      "account_credits",
      "free_agent_then_balance",
      "free_ask_then_balance",
      "legacy_token_bucket",
    ].includes(billing.strategy)
      ? {
          strategy: billing.strategy,
          ...(billing.strategy === "account_credits" &&
          typeof billing.autoReloadAllowed === "boolean"
            ? { autoReloadAllowed: billing.autoReloadAllowed }
            : {}),
        }
      : undefined;
  return {
    index,
    scenario: terminalSoak ? "terminal-soak" : scenario.name,
    runId,
    chatId,
    status: run?.status ?? "UNKNOWN",
    admissionMs,
    routeTimings,
    tokenLifetimeHours,
    tokenRunScoped,
    firstEventMs,
    firstTextMs,
    progressTiming: observation.progressTiming,
    progressTimingInterpretation:
      "Monotonic milliseconds from request start to observer receipt. Reasoning text, partial tool input and executable tool input are distinct; none proves native paint or tool completion. Replayed arrivals include detachment time.",
    totalMs: Date.now() - start,
    finished,
    detached,
    completedWhileDetached,
    ...(!terminalSoak
      ? { scenarioVerified: scenarioEvidence.verified, scenarioEvidence }
      : {}),
    ...(terminalSoak
      ? {
          toolStarted,
          toolOutputConfirmed,
          soakVerified:
            soakEvidence.verified && soakOutput.includes("RIFT_SOAK_DONE"),
          soakEvidence,
          soakResponse: soakOutput.slice(0, 3000),
        }
      : {}),
    duplicateEvents,
    workerVersion: run?.version,
    cleanup: cleanupEvidence(run),
    startupTiming: startupTimingEvidence(run),
    setupPhases: setupPhaseTimingEvidence(meta),
    // Separate dispatch/worker startup from setup and provider latency. These
    // timestamps are already produced by the worker; never infer queue time
    // from an intentionally detached observer's first replayed event.
    taskStartLatencyMs: meta.taskStartLatencyMs,
    routeStartedAt: meta.routeStartedAt,
    triggerRequestedAt: meta.triggerRequestedAt,
    workerModelRequestedMs: meta.providerRequestedMs,
    workerFirstChunkMs: meta.firstModelChunkMs,
    workerFirstPrepareMs: meta.firstPrepareStepMs,
    workerFirstOwnershipWaitMs: meta.firstOwnershipWaitMs,
    workerFirstPrepareFinishedMs: meta.firstPrepareFinishedMs,
    // Includes SDK serialization/network/provider time; not pure provider TTFT.
    afterPrepareToFirstChunkMs:
      typeof meta.firstModelChunkMs === "number" &&
      typeof meta.firstPrepareFinishedMs === "number"
        ? meta.firstModelChunkMs - meta.firstPrepareFinishedMs
        : undefined,
    workerFirstTextMs: meta.firstModelTextMs,
    textDeliveryMs:
      typeof meta.firstModelTextAt === "number" && firstTextMs !== undefined
        ? start + firstTextMs - meta.firstModelTextAt
        : undefined,
    systemPromptTokens: meta.systemPromptTokens,
    setup,
    ...(billingReservation ? { billingReservation } : {}),
  };
}
(async () => {
  const samples = [];
  for (let i = 1; i <= count; i++) {
    try {
      samples.push(await sample(i));
    } catch (error) {
      samples.push({
        index: i,
        scenario: terminalSoak
          ? "terminal-soak"
          : scenarioNames[(i - 1) % scenarioNames.length],
        status: "PROBE_ERROR",
        error: error.name,
      });
    }
    console.log(JSON.stringify(samples.at(-1)));
    const result = {
      at: new Date().toISOString(),
      mode: terminalSoak
        ? "terminal-soak"
        : disconnect
          ? "disconnect-recovery"
          : "startup",
      origin,
      chatStorage: persisted ? "persisted" : "temporary",
      model: selectedModel,
      effort: "medium",
      scenarios: terminalSoak ? ["terminal-soak"] : scenarioNames,
      samples,
      summary: {
        cleanupVerified: samples.filter((s) => s.cleanup?.verified).length,
        completed: samples.filter((s) => s.status === "COMPLETED" && s.finished)
          .length,
        verified: samples.filter((s) =>
          terminalSoak ? s.soakVerified : s.scenarioVerified,
        ).length,
        byScenario: Object.fromEntries(
          [...new Set(samples.map((s) => s.scenario))].map((name) => {
            const subset = samples.filter((s) => s.scenario === name);
            return [
              name,
              {
                samples: subset.length,
                smallSample: subset.length < 20,
                verified: subset.filter((s) =>
                  terminalSoak ? s.soakVerified : s.scenarioVerified,
                ).length,
                firstText: stats(subset, "firstTextMs"),
                admission: stats(subset, "admissionMs"),
                workerModelRequested: stats(subset, "workerModelRequestedMs"),
              },
            ];
          }),
        ),
        firstText: stats(samples, "firstTextMs"),
        admission: stats(samples, "admissionMs"),
        workerModelRequested: stats(samples, "workerModelRequestedMs"),
      },
      note: disconnect
        ? "Recovery test: firstText includes intentional disconnection and replay after completion; not live first-token latency."
        : scenarioNames.length > 1
          ? "Mixed workload: pooled timings are not comparable to prior greeting-only samples. Per-scenario groups below 20 samples remain exploratory; overall sample count does not establish a per-scenario SLO."
          : "Small sample; p95 is nearest rank and is not a production SLO estimate.",
    };
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  }
  if (
    samples.some(
      (s) =>
        s.status !== "COMPLETED" ||
        (terminalSoak &&
          (!s.toolStarted || !s.soakVerified || !s.cleanup?.verified)) ||
        (!terminalSoak && !s.scenarioVerified) ||
        !s.finished ||
        (disconnect && (!s.completedWhileDetached || s.duplicateEvents)),
    )
  )
    process.exitCode = 1;
})().catch((error) => {
  console.error(JSON.stringify({ error: error.name }));
  process.exitCode = 1;
});
