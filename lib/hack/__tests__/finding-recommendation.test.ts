import { extractFindingRecommendation } from "../finding-recommendation";

describe("extractFindingRecommendation", () => {
  it("prefers the remediation reported with the finding over a title heuristic", () => {
    const evidence =
      "[high] Unauthenticated debug configuration endpoint on checkout-api evidence: HTTP status: 200 remediation: Disable or remove /debug/config from any internet-facing deployment. Require authentication and never return tokens.";

    expect(
      extractFindingRecommendation(
        evidence,
        "Enforce MFA, rate-limit authentication, and remove weak credentials.",
      ),
    ).toBe(
      "Disable or remove /debug/config from any internet-facing deployment. Require authentication and never return tokens.",
    );
  });

  it("uses the heuristic when the finding does not include remediation", () => {
    expect(
      extractFindingRecommendation(
        "[high] TLS certificate expired",
        "Deploy a valid certificate and enable HSTS.",
      ),
    ).toBe("Deploy a valid certificate and enable HSTS.");
  });
});
