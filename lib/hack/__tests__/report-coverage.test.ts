import {
  summarizeCoverage,
  extractTerminalRecords,
  canPresentCleanResult,
} from "../report-coverage";

const terminalPart = (
  command: string,
  exitCode?: number,
  output = "some output",
) => ({
  type: "tool-run_terminal_cmd",
  state: "output-available",
  input: { command },
  output: { result: { exitCode, output } },
});

const session = (parts: Record<string, unknown>[]) => [{ parts }];

const PHASES = ["RECON", "SCAN", "EXPLOIT", "REPORT"];

const summarize = (overrides: Partial<Parameters<typeof summarizeCoverage>[0]> = {}) =>
  summarizeCoverage({
    messages: session([terminalPart("nmap -sV target", 0)]),
    allPhases: PHASES,
    ranPhases: PHASES,
    stoppedEarly: false,
    target: "target.example",
    ...overrides,
  });

describe("reading what actually happened", () => {
  it("pulls each terminal command out with its outcome", () => {
    const records = extractTerminalRecords(
      session([terminalPart("nmap", 0), terminalPart("nuclei", 1, "")]),
    );
    expect(records).toEqual([
      { command: "nmap", exitCode: 0, hadOutput: true },
      { command: "nuclei", exitCode: 1, hadOutput: false },
    ]);
  });

  it("ignores parts that are not finished terminal commands", () => {
    const records = extractTerminalRecords(
      session([
        { type: "text", text: "I will scan now" },
        { type: "tool-run_terminal_cmd", state: "input-available", input: {} },
      ]),
    );
    expect(records).toEqual([]);
  });
});

describe("a report has to say what it did not check", () => {
  it("names failed commands, because a failed tool checked nothing", () => {
    const coverage = summarize({
      messages: session([
        terminalPart("nmap -sV target", 0),
        terminalPart("nuclei -u target", 1),
      ]),
    });

    expect(coverage.toolErrors).toEqual([
      { command: "nuclei -u target", exitCode: 1 },
    ]);
    expect(coverage.limitations.join(" ")).toContain("checked nothing");
  });

  it("lists phases that never ran, so silence is not read as a result", () => {
    const coverage = summarize({ ranPhases: ["RECON"] });

    expect(coverage.uncoveredPhases).toEqual(["SCAN", "EXPLOIT", "REPORT"]);
    expect(coverage.limitations.join(" ")).toContain(
      "No conclusion should be drawn",
    );
  });

  it("says plainly that a stopped assessment left checks unrun", () => {
    const coverage = summarize({ stoppedEarly: true });
    expect(coverage.limitations.join(" ")).toContain(
      "absence from this report is not a result",
    );
  });

  it("admits when nothing was gathered at all", () => {
    const coverage = summarize({ messages: session([]) });
    expect(coverage.noEvidenceGathered).toBe(true);
    expect(coverage.limitations.join(" ")).toContain("did not gather evidence");
  });

  it("treats output-free commands as no evidence", () => {
    const coverage = summarize({
      messages: session([terminalPart("whoami", 0, "   ")]),
    });
    expect(coverage.noEvidenceGathered).toBe(true);
  });

  it("flags an assessment run without a declared scope", () => {
    const coverage = summarize({ target: "  " });
    expect(coverage.limitations.join(" ")).toContain("declared authorization");
  });

  it("reports no limitations when the assessment genuinely covered its ground", () => {
    const coverage = summarize();
    expect(coverage.limitations).toEqual([]);
    expect(coverage.toolErrors).toEqual([]);
  });
});

describe("when 'no findings' may be presented as clean", () => {
  it("allows it only when the assessment actually looked", () => {
    expect(canPresentCleanResult(summarize())).toBe(true);
  });

  it("refuses after a stop", () => {
    expect(canPresentCleanResult(summarize({ stoppedEarly: true }))).toBe(false);
  });

  it("refuses when a tool failed", () => {
    expect(
      canPresentCleanResult(
        summarize({
          messages: session([terminalPart("nuclei", 2)]),
        }),
      ),
    ).toBe(false);
  });

  it("refuses when whole phases never ran", () => {
    expect(canPresentCleanResult(summarize({ ranPhases: ["RECON"] }))).toBe(
      false,
    );
  });
});
