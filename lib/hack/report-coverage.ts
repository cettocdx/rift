/**
 * What an assessment did NOT establish.
 *
 * A report that lists only what was found invites the reader to treat the
 * absence of findings as evidence of safety. It is not: a scan that was stopped
 * early, or whose tools failed, or that never ran a whole class of check, has
 * simply not looked. Section 17.5 asks for scope limitations, tool errors and
 * coverage gaps, and acceptance criterion 24.6 asks the report to describe
 * them.
 *
 * Everything here is derived from the session's own record -- exit codes, which
 * phases actually ran, whether the run was cancelled. Nothing is inferred from
 * the model's prose, because prose is exactly what cannot be trusted to admit a
 * gap.
 */

export type CoverageToolError = {
  command: string;
  exitCode: number;
};

export type AssessmentCoverage = {
  /** Commands that failed. A failed tool checked nothing. */
  toolErrors: CoverageToolError[];
  /** Phases from the operation chain that were never run in this session. */
  uncoveredPhases: string[];
  /** True when the operator stopped the assessment before it concluded. */
  stoppedEarly: boolean;
  /** True when no command produced usable output at all. */
  noEvidenceGathered: boolean;
  /** Human-readable limitations, ready to render. */
  limitations: string[];
};

type TerminalRecord = {
  command: string;
  exitCode?: number;
  hadOutput: boolean;
};

/**
 * Pulls every terminal command out of a transcript with its outcome.
 *
 * Reads the same `result.exitCode` the tool row reads, so the report and the
 * trace cannot disagree about whether something failed.
 */
export function extractTerminalRecords(
  messages: ReadonlyArray<{ parts?: ReadonlyArray<Record<string, unknown>> }>,
): TerminalRecord[] {
  const records: TerminalRecord[] = [];

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const type = typeof part.type === "string" ? part.type : "";
      if (type !== "tool-run_terminal_cmd" && type !== "tool-shell") continue;
      if (part.state !== "output-available") continue;

      const input = part.input as { command?: unknown } | undefined;
      const command =
        typeof input?.command === "string" ? input.command : "(unknown command)";

      const output = part.output as
        | { result?: { exitCode?: unknown; output?: unknown }; exitCode?: unknown; output?: unknown }
        | undefined;
      const rawExit = output?.result?.exitCode ?? output?.exitCode;
      const rawOutput = output?.result?.output ?? output?.output;

      records.push({
        command,
        exitCode: typeof rawExit === "number" ? rawExit : undefined,
        hadOutput: typeof rawOutput === "string" && rawOutput.trim().length > 0,
      });
    }
  }

  return records;
}

export function summarizeCoverage({
  messages,
  allPhases,
  ranPhases,
  stoppedEarly,
  target,
}: {
  messages: ReadonlyArray<{ parts?: ReadonlyArray<Record<string, unknown>> }>;
  /** Every phase the workbench offers. */
  allPhases: readonly string[];
  /** Phases this session actually ran. */
  ranPhases: readonly string[];
  stoppedEarly: boolean;
  target: string;
}): AssessmentCoverage {
  const records = extractTerminalRecords(messages);

  const toolErrors = records
    .filter((record) => typeof record.exitCode === "number" && record.exitCode !== 0)
    .map((record) => ({
      command:
        record.command.length > 120
          ? `${record.command.slice(0, 117)}...`
          : record.command,
      exitCode: record.exitCode as number,
    }));

  const ran = new Set(ranPhases.map((phase) => phase.toUpperCase()));
  const uncoveredPhases = allPhases.filter(
    (phase) => !ran.has(phase.toUpperCase()),
  );

  const noEvidenceGathered =
    records.length === 0 || records.every((record) => !record.hadOutput);

  const limitations: string[] = [];

  if (!target.trim()) {
    limitations.push(
      "No target scope was set for this session, so nothing was assessed against a declared authorization.",
    );
  }

  if (stoppedEarly) {
    limitations.push(
      "The assessment was stopped before it concluded. Checks after that point did not run, and their absence from this report is not a result.",
    );
  }

  if (noEvidenceGathered) {
    limitations.push(
      "No command produced usable output in this session. This report describes an assessment that did not gather evidence.",
    );
  }

  if (toolErrors.length > 0) {
    limitations.push(
      `${toolErrors.length} command${toolErrors.length === 1 ? "" : "s"} exited with an error. A failed tool checked nothing, so any area it covers remains unexamined.`,
    );
  }

  if (uncoveredPhases.length > 0) {
    limitations.push(
      `${uncoveredPhases.length} assessment phase${uncoveredPhases.length === 1 ? "" : "s"} did not run: ${uncoveredPhases.join(", ")}. No conclusion should be drawn about ${uncoveredPhases.length === 1 ? "it" : "them"}.`,
    );
  }

  return {
    toolErrors,
    uncoveredPhases,
    stoppedEarly,
    noEvidenceGathered,
    limitations,
  };
}

/**
 * Whether a "no findings" result may be presented as a clean bill of health.
 *
 * Only when the assessment actually looked. Anything else and the report must
 * say it did not, rather than let silence read as safety.
 */
export function canPresentCleanResult(coverage: AssessmentCoverage): boolean {
  return (
    !coverage.stoppedEarly &&
    !coverage.noEvidenceGathered &&
    coverage.toolErrors.length === 0 &&
    coverage.uncoveredPhases.length === 0
  );
}
