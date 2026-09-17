import { extractFindings } from "../HackerMode";

describe("Hack Workbench finding recommendations", () => {
  it("upgrades a preliminary duplicate with the reported remediation", () => {
    const title =
      "Unauthenticated debug configuration endpoint on checkout-api @ https://lab.example/debug/config";
    const preliminary = `[high] ${title}`;
    const complete = `${preliminary} evidence: HTTP status: 200 X-RIFT-Lab: authorized-demo remediation: Disable or remove /debug/config from any internet-facing deployment. Require authentication and never return tokens.`;

    const findings = extractFindings(`${preliminary}\n${complete}`);

    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain("HTTP status: 200");
    expect(findings[0].rec).toBe(
      "Disable or remove /debug/config from any internet-facing deployment. Require authentication and never return tokens.",
    );
  });

  it("keeps remediation continuation lines emitted by report finding", () => {
    const output = [
      "[high] Unauthenticated /debug/config exposes internal service URL and demo token @ https://lab.example/debug/config",
      "cvss: 7",
      "evidence: GET /debug/config returned HTTP 200. Headers: X-RIFT-Lab: authorized-demo.",
      "remediation: Disable or remove /debug/config from internet-facing deployments; restrict it to authenticated admin networks, never return tokens, and rotate the exposed token.",
    ].join("\n");

    const findings = extractFindings(output);

    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain("HTTP 200");
    expect(findings[0].rec).toBe(
      "Disable or remove /debug/config from internet-facing deployments; restrict it to authenticated admin networks, never return tokens, and rotate the exposed token.",
    );
  });
});
