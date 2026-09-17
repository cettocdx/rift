import { createReportFinding } from "../report-finding";
import type { ToolContext } from "@/types";
import type { RunRecorder, TerminalCommandRecord } from "@/lib/ai/runs/run-recorder";

/**
 * E6. A finding used to exist only as a formatted string in the tool's output.
 * Nothing recorded which command proved it, and its `evidence` field was
 * optional free text -- so once the run ended, "what is this based on?" had no
 * answer. These lock the finding to a durable record attributed to the command
 * the runtime actually ran.
 */

function makeRecorder(commands: TerminalCommandRecord[] = []) {
  const findings: Parameters<RunRecorder["recordFinding"]>[0][] = [];
  const recorder: RunRecorder = {
    runId: "run-1",
    recordTerminalCommand: (record) => commands.push(record),
    lastTerminalCommand: () => commands[commands.length - 1],
    appendEvent: async () => {},
    recordFinding: async (finding) => {
      findings.push(finding);
    },
  };
  return { recorder, findings };
}

const runTool = (context: Partial<ToolContext>, input: Record<string, unknown>) => {
  const tool = createReportFinding(context as ToolContext);
  const execute = (tool as unknown as {
    execute: (i: unknown, o: unknown) => Promise<any>;
  }).execute;
  return execute(input, { toolCallId: "call-report", messages: [] });
};

describe("report_finding records a durable, attributed finding", () => {
  it("records the finding and ties it to the last command that ran", async () => {
    const { recorder, findings } = makeRecorder([
      {
        toolCallId: "call-nmap",
        command: "nmap -sV target.example",
        exitCode: 0,
        durationMs: 8200,
        output: "443/tcp open  https",
      },
    ]);

    const result = await runTool(
      { runRecorder: recorder },
      {
        title: "Exposed admin panel",
        severity: "high",
        target: "https://target.example/admin",
        evidence: "HTTP 200 without authentication",
      },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      title: "Exposed admin panel",
      severity: "high",
      provenByCommand: "nmap -sV target.example",
    });
    // The model is told what the finding was tied to, so it does not
    // re-report the same thing to make sure it landed.
    expect(result.provenByCommand).toBe("nmap -sV target.example");
    expect(result.recorded).toBe(true);
  });

  it("honours an explicit command attribution over the most recent one", async () => {
    const { recorder, findings } = makeRecorder([
      { toolCallId: "call-a", command: "first" },
      { toolCallId: "call-b", command: "second" },
    ]);

    await runTool(
      { runRecorder: recorder },
      {
        title: "Injection",
        severity: "critical",
        provenByToolCallId: "call-a",
      },
    );

    expect(findings[0].provenByToolCallId).toBe("call-a");
  });

  it("still returns the dashboard line when nothing is recording", async () => {
    // The dashboard counters are driven by this output. Recording is a record
    // OF the work, not a precondition FOR it: with no recorder the tool must
    // behave exactly as it always did.
    const result = await runTool(
      {},
      { title: "Open redirect", severity: "medium", target: "example.com" },
    );

    expect(result.output).toContain("[medium] Open redirect @ example.com");
    expect(result.recorded).toBe(true);
    expect(result.provenByCommand).toBeUndefined();
  });

  it("keeps the canonical severity tag first so the dashboard can parse it", async () => {
    const { recorder } = makeRecorder();
    const result = await runTool(
      { runRecorder: recorder },
      {
        title: "Weak cipher",
        severity: "low",
        cvss: 3,
        evidence: "TLS_RSA_WITH_3DES_EDE_CBC_SHA offered",
        recommendation: "Disable 3DES",
      },
    );

    const lines = result.output.split("\n");
    expect(lines[0]).toBe("[low] Weak cipher");
    expect(lines).toContain("cvss: 3");
    expect(lines).toContain("remediation: Disable 3DES");
  });
});
