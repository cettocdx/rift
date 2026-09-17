import fs from "node:fs";
import path from "node:path";
import { renderHackReport } from "@/lib/hack/report-html";
import { summarizeCoverage } from "@/lib/hack/report-coverage";

// A3. The Hack route (`/api/hack-chat`) streams resumably: the security
// operation runs decoupled from the client fetch so a dropped connection can
// reconnect. Because of that, the client `useChat` `stop()` only closes the
// local reader -- it does not halt the run, which keeps generating, billing,
// and executing tools server-side. The durable stream has to be cancelled too.
// This locks Stop to the server-side cancellation so the decoupling can't
// silently turn Stop back into a no-op.
describe("Hack Workbench Stop reaches the server", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/components/HackerMode.tsx"),
    "utf8",
  );

  it("cancels the durable stream, not just the client reader", () => {
    expect(source).toContain(
      "useMutation(\n    api.chatStreams.cancelStreamFromClient,\n  )",
    );
    expect(source).toContain("const stopOperation = useCallback(");
    expect(source).toContain("cancelHackRun({");
    expect(source).toMatch(
      /\.cancel\(\s*producer === "http" \? streamStateRef\.current\.http : fallbackId,\s*\(dispatchId\) =>/,
    );
    expect(source).toContain("() => cancelStreamMutation({ chatId })");
  });

  it("routes every Stop control through stopOperation, never a bare stop()", () => {
    // Every operator-facing Stop must go through the helper that also cancels
    // the run. The only place a bare `stop()` is allowed is inside the helper.
    const bareStops =
      source.match(/(?<!cancelStreamMutation[\s\S]{0,80})\bvoid stop\(\)/g) ??
      [];
    // Exactly one: the client abort inside stopOperation itself.
    expect(source.match(/\bvoid stop\(\);/g)?.length ?? 0).toBe(1);
    // And no control still does `if (running) void stop()`.
    expect(source).not.toContain("if (running) void stop()");
    expect(source).not.toContain("onClick={() => void stop()}");
    void bareStops;
  });
});

// B2. The workbench must not assert an authorization or a capability it has
// not established. The scope badge is the operator's declaration; there isn't
// one until a target is entered, and the client cannot measure whether the
// sandbox toolchain is actually up.
describe("Hack Workbench does not assert what it has not established", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/components/HackerMode.tsx"),
    "utf8",
  );

  it("labels a target as selected without asserting authorization", () => {
    expect(source).not.toContain('badge="AUTHORIZED"');
    expect(source).toContain(
      'badge={target.trim() ? "SCOPE SET" : "SCOPE REQUIRED"}',
    );
  });

  it("does not hardcode a 100% toolchain claim", () => {
    expect(source).not.toContain('progressLabel="Toolchain available"');
    expect(source).not.toMatch(
      /progressLabel="Toolchain available"\s*\n\s*progress=\{100\}/,
    );
    expect(source).not.toContain('progressLabel="Session readiness"');
  });

  it("shows SCOPE REQUIRED in the welcome banner until a target exists", () => {
    expect(source).toContain(
      '{target.trim() ? "SELECTED SCOPE" : "SCOPE REQUIRED"}',
    );
  });
});

// 24.6. A report that lists only what was found invites the reader to treat the
// absence of findings as safety. A stopped scan, a failed tool, or a phase that
// never ran has simply not looked.
describe("the Hack report declares what it did not check", () => {
  const report = renderHackReport({
    coverage: summarizeCoverage({
      messages: [],
      allPhases: [],
      ranPhases: [],
      stoppedEarly: false,
      target: "example.test",
    }),
    findings: [],
    ports: [],
    subdomains: [],
    endpoints: [],
    target: "example.test",
    sevCounts: { C: 0, H: 0, M: 0, L: 0 },
    threat: "Unknown",
  });
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/components/HackerMode.tsx"),
    "utf8",
  );

  it("derives coverage from the session rather than from the model's prose", () => {
    expect(source).toContain("summarizeCoverage({");
    expect(source).toContain("stoppedEarly: stoppedEarlyRef.current");
    expect(source).toContain("ranPhases: [...ranPhasesRef.current]");
  });

  it("puts scope and limitations before the findings, not after", () => {
    const scopeAt = report.indexOf("<h2>Scope and Limitations</h2>");
    const findingsAt = report.indexOf("<h2>Findings</h2>");
    expect(scopeAt).toBeGreaterThan(-1);
    expect(findingsAt).toBeGreaterThan(scopeAt);
  });

  it("refuses to let an empty result read as a clean one", () => {
    expect(report).toContain("this is not a clean result");
    expect(report).toContain("No findings recorded in this session.");
  });

  it("records a stop as a coverage fact", () => {
    // Everything after a stop did not run, and the report has to say so.
    expect(source).toContain("stoppedEarlyRef.current = true");
  });

  it("records which phase each launched task belongs to", () => {
    expect(source).toContain("ranPhasesRef.current.add(phase)");
  });
});
