import { tool } from "ai";
import { z } from "zod";
import { ToolContext } from "@/types";
import { looseEnum, looseInt, coerceEnum, coerceInt } from "./utils/loose-args";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

/**
 * Record a CONFIRMED security finding in the structured findings tracker.
 *
 * The workbench dashboard (Findings / Critical / Medium counters, Verified risk)
 * is derived from tool OUTPUT — never from the model's prose. Saying "kritik" /
 * "critical" in a normal sentence does NOT register a finding. This tool is the
 * ONLY authoritative way to put a finding on the board: its output emits a
 * canonical `[severity] title @ target` line that the dashboard parses
 * deterministically, so severity comes from a structured field (not fuzzy text)
 * and is language-independent.
 */
export const createReportFinding = (context: ToolContext) =>
  tool({
    description: `Record ONE confirmed security finding on the assessment dashboard. Call this exactly once per distinct finding, the moment you have verified it — do not batch them into prose.

The Findings / Critical / High / Medium counters and the Verified-risk level are driven by THIS tool's output, not by anything you write in a sentence. If you only describe a finding in text (in any language), it will NOT be counted. So: whenever you confirm something worth reporting, call report_finding.

Rules:
- severity must reflect real, evidence-backed impact (CVSS-style). Do NOT inflate — a 301 redirect, an open directory, or a version banner is info/low, not critical. Reserve critical/high for confirmed, exploitable impact (RCE, auth bypass, injection, exposed secrets/PII, SSRF to internal).
- Always attach concrete evidence (the request/response, output line, payload, or exact observation that proves it).
- One call per finding; re-reporting the same title is de-duplicated.`,
    inputSchema: z.object({
      title: z
        .string()
        .describe("Short one-line title of the finding (e.g. 'Reflected XSS in search param')"),
      severity: looseEnum(SEVERITIES).describe(
        "One of: critical, high, medium, low, info. Evidence-backed CVSS-style severity — never inflated.",
      ),
      target: z
        .string()
        .optional()
        .describe("Affected host / URL / endpoint (e.g. https://target.com/login)"),
      evidence: z
        .string()
        .optional()
        .describe(
          "Concrete proof: the request/response, output line, payload, or exact observation that confirms the finding.",
        ),
      recommendation: z
        .string()
        .optional()
        .describe("How to remediate the finding."),
      cvss: looseInt
        .optional()
        .describe("Optional CVSS base score 0-10 (integer) if known."),
      provenByToolCallId: z
        .string()
        .optional()
        .describe(
          "Optional id of the terminal tool call that proves this finding. Leave unset to attribute it to the most recent command.",
        ),
    }),
    execute: async ({
      title,
      severity,
      target,
      evidence,
      recommendation,
      cvss,
      provenByToolCallId,
    }) => {
      const sev = coerceEnum(severity, SEVERITIES, "info")!;
      const cvssNum = coerceInt(cvss);
      const at = target ? ` @ ${target}` : "";
      // Canonical line the dashboard parses ([severity] tag → counter). Keep the
      // tag first so extractFindings picks the structured severity, not prose.
      const lines = [`[${sev}] ${title}${at}`];
      if (typeof cvssNum === "number") lines.push(`cvss: ${cvssNum}`);
      if (evidence) lines.push(`evidence: ${evidence}`);
      if (recommendation) lines.push(`remediation: ${recommendation}`);
      const output = lines.join("\n");

      // A finding used to exist only as this string. Nothing recorded which
      // command proved it, and the evidence field was optional free text -- so
      // "what is this based on?" had no answer once the run ended. Record it
      // durably, attributed to the command the runtime actually ran.
      const recorder = context.runRecorder;
      const proven = provenByToolCallId
        ? undefined
        : recorder?.lastTerminalCommand();
      await recorder?.recordFinding({
        title,
        severity: sev,
        target,
        evidence,
        recommendation,
        cvss: cvssNum,
        provenByToolCallId,
        provenByCommand: proven?.command,
      });

      return {
        output,
        recorded: true,
        severity: sev,
        title,
        // Tells the model the finding is on the record, and what it was tied
        // to, so it does not re-report the same thing to "make sure".
        provenByCommand: proven?.command ?? undefined,
      };
    },
  });
