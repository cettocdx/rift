// Acceptance comes from the command result, never from a model's success claim.
function evaluateTerminalSoak(evidence) {
  const { calls, outputs, steps, command } = evidence ?? {};
  if (!Array.isArray(calls) || !Array.isArray(outputs) || !Number.isInteger(steps) || steps < 1 || typeof command !== "string" || !command)
    return { verified: false };
  const commandCount = calls.length;
  const call = calls[0];
  const input = call?.input;
  const commandMatches = call?.toolName === "run_terminal_cmd" &&
    typeof input?.command === "string" && input.command.trim() === command &&
    (input?.action === undefined || input.action === "exec") &&
    (input?.is_background === undefined || input.is_background === false) &&
    (input?.interactive === undefined || input.interactive === false);
  const matching = outputs.filter((item) => typeof call?.toolCallId === "string" && item?.toolCallId === call.toolCallId);
  const result = matching.length === 1 ? matching[0]?.output?.result : undefined;
  const markers = typeof result?.output === "string"
    ? [...result.output.matchAll(/\bRIFT_SOAK_(\d+)\b/g)].map((match) => Number(match[1]))
    : [];
  const markersComplete = markers.length === steps && markers.every((marker, index) => marker === index);
  const exitConfirmed = result?.exitCode === 0 && result?.outcome !== "unknown";
  const durationConfirmed = typeof result?.durationMs === "number" && result.durationMs >= steps * 10000;
  return {
    verified: commandCount === 1 && commandMatches && matching.length === 1 && markersComplete && exitConfirmed && durationConfirmed,
    commandCount,
    commandMatches,
    durationConfirmed,
    durationMs: result?.durationMs ?? null,
    resultCount: matching.length,
    markersComplete,
    markerCount: markers.length,
    exitConfirmed,
    exitCode: result?.exitCode ?? null,
  };
}
module.exports = { evaluateTerminalSoak };
