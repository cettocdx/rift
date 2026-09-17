import {
  extractFindings,
  extractPorts,
  extractSubdomains,
  extractEndpoints,
  type Sev,
} from "./evidence-parsers";
import { summarizeCoverage } from "./report-coverage";
import { HACK_TASK_GROUPS } from "./task-catalog";

type Message = { role?: string; parts?: Array<Record<string, unknown>> };
/** Same evidence inputs as the Workbench: assistant tool output and streamed
 * terminal events only. Assistant conclusions and user prompts are not evidence. */
export function assessmentData(
  messages: Message[],
  options: { target: string; taskIds?: string[]; stoppedEarly?: boolean },
) {
  const outputKeys = [
    "stdout",
    "output",
    "content",
    "text",
    "result",
    "brief",
    "stderr",
  ];
  const stringField = (value: Record<string, unknown>) =>
    outputKeys
      .map((key) => value[key])
      .find((item) => typeof item === "string" && item.trim()) as
      | string
      | undefined;
  const pieces: string[] = [];
  for (const message of messages) {
    if (message.role === "user") continue;
    for (const part of message.parts ?? []) {
      if (part.type === "data-terminal") {
        const data = part.data as Record<string, unknown> | undefined;
        if (typeof data?.terminal === "string") pieces.push(data.terminal);
      }
      if (typeof part.type !== "string" || !part.type.startsWith("tool-"))
        continue;
      const out = (part.output ?? part.result ?? {}) as Record<string, unknown>;
      let text = stringField(out) || stringField(part);
      if (!text)
        for (const key of outputKeys) {
          const nested = out[key];
          if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            text = stringField(nested as Record<string, unknown>);
            if (text) break;
          }
        }
      if (text) pieces.push(text);
    }
  }
  const raw = pieces.join("\n");
  const evidence =
    raw.length > 512000
      ? raw.slice(0, 179200) + "\n… evidence truncated …\n" + raw.slice(-332800)
      : raw;
  const findings = extractFindings(evidence);
  const ports = extractPorts(evidence);
  const sevCounts: Record<Sev, number> = { C: 0, H: 0, M: 0, L: 0 };
  for (const finding of findings) sevCounts[finding.sev]++;
  const ranPhases = HACK_TASK_GROUPS.filter((group) =>
    group.ops.some((task) => options.taskIds?.includes(task.id)),
  ).map((group) => group.title);
  const coverage = summarizeCoverage({
    messages,
    allPhases: HACK_TASK_GROUPS.map((group) => group.title),
    ranPhases,
    stoppedEarly: options.stoppedEarly ?? false,
    target: options.target,
  });
  if (raw.length > 512000)
    coverage.limitations.push(
      "Evidence exceeds the display limit; this report contains a bounded excerpt.",
    );
  return {
    target: options.target,
    evidence,
    findings,
    ports,
    subdomains: extractSubdomains(evidence, options.target),
    endpoints: extractEndpoints(evidence),
    coverage,
    sevCounts,
    threat: sevCounts.C
      ? "CRITICAL"
      : sevCounts.H
        ? "HIGH"
        : sevCounts.M
          ? "MEDIUM"
          : findings.length
            ? "LOW"
            : "UNASSESSED",
  };
}
