// Pure option parsing and stream evidence; no credentials, SDK or network imports.
const SCENARIOS = ["greeting", "explanation", "terminal"];
function parseBenchmarkOptions(args) {
  const flags = new Set([
    "--terminal-soak",
    "--persisted",
    "--disconnect",
    "--help",
  ]);
  const values = new Set([
    "--samples",
    "--output",
    "--soak-steps",
    "--origin",
    "--model",
    "--scenario",
  ]);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if ((!flags.has(key) && !values.has(key)) || key in parsed)
      throw new Error("Unknown or repeated option");
    if (flags.has(key)) parsed[key] = true;
    else {
      const value = args[++i];
      if (!value?.trim() || value.startsWith("--"))
        throw new Error("Missing option value");
      parsed[key] = value;
    }
  }
  const count = Number(parsed["--samples"] ?? 3);
  const soakSteps = Number(parsed["--soak-steps"] ?? 18);
  if (!Number.isInteger(count) || count < 1 || count > 20)
    throw new Error("Use 1–20 samples");
  if (!Number.isInteger(soakSteps) || soakSteps < 1 || soakSteps > 120)
    throw new Error("Use 1–120 soak steps");
  const terminalSoak = !!parsed["--terminal-soak"];
  if (terminalSoak && (count !== 1 || "--scenario" in parsed))
    throw new Error("Terminal soak requires --samples 1 and no --scenario");
  if (!terminalSoak && "--soak-steps" in parsed)
    throw new Error("--soak-steps requires --terminal-soak");
  const scenario = parsed["--scenario"] ?? "greeting";
  if (![...SCENARIOS, "mixed"].includes(scenario))
    throw new Error(
      "Scenario must be greeting, explanation, terminal or mixed",
    );
  const origin = parsed["--origin"] ?? "http://localhost:3020";
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Origin must be an HTTP(S) origin without credentials or a path",
    );
  return {
    count,
    soakSteps,
    terminalSoak,
    scenarioNames: scenario === "mixed" ? [...SCENARIOS] : [scenario],
    persisted: !!parsed["--persisted"],
    disconnect: terminalSoak || !!parsed["--disconnect"],
    output: parsed["--output"] ?? "/tmp/rift-startup-benchmark.json",
    origin: url.origin,
    selectedModel: parsed["--model"] ?? "build-codex",
    help: !!parsed["--help"],
  };
}
function buildScenario(name, nonce) {
  if (!SCENARIOS.includes(name)) throw new Error("Unknown scenario");
  if (typeof nonce !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(nonce))
    throw new Error("Invalid scenario nonce");
  if (name === "greeting")
    return { name, prompt: "merhaba", approvalMode: "ask" };
  if (name === "explanation")
    return {
      name,
      approvalMode: "ask",
      finalSentinel: `RIFT_EXPLANATION_DONE_${nonce}`,
      prompt: `Without using any tools, explain the difference between an absolute filesystem path and a relative filesystem path in two short sentences, with one example of each. Do not browse, run commands, create files, delegate, or use media tools. End your response with this exact line: RIFT_EXPLANATION_DONE_${nonce}`,
    };
  const outputSentinel = `RIFT_TERMINAL_${nonce}`;
  const finalSentinel = `RIFT_TERMINAL_DONE_${nonce}`;
  const command = `pwd; printf '%s\\n' '${outputSentinel}'`;
  return {
    name,
    approvalMode: "full",
    sandboxPreference: "e2b",
    command,
    outputSentinel,
    finalSentinel,
    prompt: `Run exactly one read-only cloud terminal command using run_terminal_cmd, action exec, foreground noninteractive mode and timeout 30 seconds. Pass this exact command without modification:\n${command}\nDo not create or edit files, access the network, browse, delegate, or use any other tools. Never retry the command, including after an uncertain result. Wait for its result. Only if the tool confirms exit code 0 and its output contains the working directory and ${outputSentinel}, end your response with this exact line: ${finalSentinel}. Otherwise report the actual failure.`,
  };
}
function createObservation() {
  return {
    progressTiming: {},
    calls: [],
    outputs: [],
    attempts: new Set(),
    text: "",
    finished: false,
    streamError: false,
  };
}
function collectBenchmarkChunk(observation, chunk, elapsedMs) {
  // Arrival at the observer, not native paint time or provider creation time.
  // Reconnect/replay retains the first observation; setup envelopes are not work.
  if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
    const field = chunk.type === "reasoning-delta" && chunk.delta?.trim()
      ? "firstReasoningMs"
      : chunk.type === "text-delta" && chunk.delta?.trim()
        ? "firstTextMs"
        : chunk.type === "tool-input-start"
          ? "firstToolInputMs"
          : chunk.type === "tool-input-available"
            ? "firstToolReadyMs"
            : undefined;
    if (field) observation.progressTiming[field] ??= elapsedMs;
  }
  if (
    ["tool-input-start", "tool-input-available", "tool-input-error"].includes(
      chunk.type,
    )
  ) {
    observation.attempts.add(
      chunk.toolCallId ?? `missing-${observation.attempts.size}`,
    );
    if (chunk.type === "tool-input-error") observation.streamError = true;
  }
  if (chunk.type === "tool-input-available")
    observation.calls.push({
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
      input: chunk.input,
    });
  if (chunk.type === "tool-output-available")
    observation.outputs.push({
      toolCallId: chunk.toolCallId,
      output: chunk.output,
    });
  if (chunk.type === "text-delta") observation.text += chunk.delta ?? "";
  if (chunk.type === "finish") observation.finished = true;
  if (
    ["error", "abort", "tool-output-error", "tool-output-denied"].includes(
      chunk.type,
    )
  )
    observation.streamError = true;
}
function evaluateScenario({ scenario, observation, status }) {
  const complete =
    status === "COMPLETED" && observation.finished && !observation.streamError;
  const finalConfirmed =
    !!scenario.finalSentinel &&
    observation.text.trimEnd().endsWith(scenario.finalSentinel);
  const common = {
    commandCount: observation.calls.length,
    toolAttemptCount: observation.attempts.size,
    finalConfirmed,
  };
  if (scenario.name === "greeting") return { verified: complete, ...common };
  if (scenario.name === "explanation")
    return {
      ...common,
      verified:
        complete &&
        finalConfirmed &&
        observation.attempts.size === 0 &&
        observation.calls.length === 0 &&
        observation.outputs.length === 0 &&
        observation.text.replace(scenario.finalSentinel, "").trim().length > 0,
      responseChars: observation.text.length,
      validationLimit:
        "Confirms nonempty finished text, final sentinel and no observed tools; does not grade factual correctness or explanatory quality.",
    };
  const call = observation.calls[0];
  const input = call?.input;
  const commandMatches =
    call?.toolName === "run_terminal_cmd" &&
    typeof call?.toolCallId === "string" &&
    call.toolCallId.length > 0 &&
    input?.command === scenario.command &&
    [undefined, "exec"].includes(input.action) &&
    [undefined, false].includes(input.is_background) &&
    [undefined, false].includes(input.interactive) &&
    (input.timeout === undefined ||
      (Number.isFinite(input.timeout) &&
        input.timeout > 0 &&
        input.timeout <= 60));
  const outputs = observation.outputs.filter(
    (item) => item.toolCallId === call?.toolCallId,
  );
  const result = outputs.length === 1 ? outputs[0]?.output?.result : undefined;
  const lines =
    typeof result?.output === "string"
      ? result.output.replace(/\r\n/g, "\n").trimEnd().split("\n")
      : [];
  const outputConfirmed =
    lines.length === 2 &&
    lines[0].startsWith("/") &&
    lines[1] === scenario.outputSentinel;
  const errorPresent =
    result?.error !== undefined && result.error !== null && result.error !== "";
  const toolOutputSuccess =
    outputs.length === 1 ? outputs[0]?.output?.success : undefined;
  const exitConfirmed =
    result?.exitCode === 0 &&
    result?.outcome !== "unknown" &&
    result?.success !== false &&
    toolOutputSuccess !== false &&
    !errorPresent;
  return {
    ...common,
    verified:
      complete &&
      finalConfirmed &&
      observation.calls.length === 1 &&
      observation.attempts.size === 1 &&
      commandMatches &&
      outputs.length === 1 &&
      observation.outputs.length === 1 &&
      outputConfirmed &&
      exitConfirmed,
    commandMatches,
    outputConfirmed,
    exitConfirmed,
    exitCode: result?.exitCode ?? null,
    resultCount: outputs.length,
    // Record only evidence bound to the exact planned read-only command. Never copy unrelated tool payloads.
    ...(commandMatches
      ? {
          toolCall: {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: {
              command: input.command,
              cwd: input.cwd,
              action: input.action,
              is_background: input.is_background,
              interactive: input.interactive,
              timeout: input.timeout,
            },
          },
          ...(typeof toolOutputSuccess === "boolean"
            ? { toolOutputSuccess }
            : {}),
          toolResult: result
            ? {
                output:
                  typeof result.output === "string"
                    ? result.output.slice(0, 8192)
                    : null,
                exitCode: result.exitCode ?? null,
                outcome: result.outcome,
                durationMs: result.durationMs,
                errorPresent,
                ...(typeof result.success === "boolean"
                  ? { success: result.success }
                  : {}),
              }
            : null,
        }
      : {}),
    validationLimit:
      "Confirms one observed command submission and its matching exit/output. Does not prove provider-side exactly-once execution or constrain unrequested model actions before detection.",
  };
}
function validateReportedScenario(row) {
  const evidence = row.scenarioEvidence;
  if (row.scenarioVerified !== true || evidence?.verified !== true)
    return false;
  let scenario;
  try {
    scenario = buildScenario(row.scenario, row.chatId);
  } catch {
    return false;
  }
  if (scenario.name === "greeting") return true;
  if (evidence.finalConfirmed !== true) return false;
  if (scenario.name === "explanation")
    return (
      evidence.toolAttemptCount === 0 &&
      evidence.commandCount === 0 &&
      evidence.responseChars > scenario.finalSentinel.length
    );
  if (
    evidence.toolAttemptCount !== 1 ||
    evidence.commandCount !== 1 ||
    evidence.resultCount !== 1 ||
    !evidence.toolCall ||
    !evidence.toolResult
  )
    return false;
  // Re-check the recorded command/output against the sample's nonce instead of trusting a success flag.
  const observation = createObservation();
  collectBenchmarkChunk(observation, {
    type: "tool-input-available",
    ...evidence.toolCall,
  });
  collectBenchmarkChunk(observation, {
    type: "tool-output-available",
    toolCallId: evidence.toolCall.toolCallId,
    output: {
      success: evidence.toolOutputSuccess,
      result: {
        ...evidence.toolResult,
        ...(evidence.toolResult.errorPresent
          ? { error: "Recorded tool error" }
          : {}),
      },
    },
  });
  observation.finished = row.finished === true;
  observation.text = scenario.finalSentinel;
  return evaluateScenario({ scenario, observation, status: row.status })
    .verified;
}
module.exports = {
  parseBenchmarkOptions,
  buildScenario,
  createObservation,
  collectBenchmarkChunk,
  evaluateScenario,
  validateReportedScenario,
};
