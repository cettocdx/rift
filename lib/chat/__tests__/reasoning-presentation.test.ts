import { buildReasoningPresentation } from "../reasoning-presentation";

describe("reasoning presentation", () => {
  it("uses the latest named section as the live Cursor-style label", () => {
    const result = buildReasoningPresentation(
      [
        "## Mapping the greeting conversation",
        "Inspect the existing entry points and copy.",
        "",
        "**Refining the interaction rhythm**",
        "Align the loading and completion states.",
      ].join("\n"),
      true,
    );

    expect(result).toMatchObject({
      title: "Refining the interaction rhythm",
      source: "named-step",
      steps: [
        {
          id: "reasoning-step-0",
          title: "Mapping the greeting conversation",
          detail: "Inspect the existing entry points and copy.",
          status: "complete",
        },
        {
          id: "reasoning-step-1",
          title: "Refining the interaction rhythm",
          detail: "Align the loading and completion states.",
          status: "active",
        },
      ],
    });
  });

  it("marks every named step complete after streaming finishes", () => {
    const result = buildReasoningPresentation(
      "1. Inspecting the route\n2. Verifying the response",
      false,
    );

    expect(result.steps.map((step) => step.status)).toEqual([
      "complete",
      "complete",
    ]);
    expect(result.title).toBe("Verifying the response");
  });

  it("derives a compact summary without exposing fenced code", () => {
    const result = buildReasoningPresentation(
      "We need to inspect the existing component before editing.\n```ts\nconst secret = true;\n```",
      true,
    );

    expect(result.source).toBe("summary");
    expect(result.title).toBe("inspect the existing component before editing.");
    expect(result.title).not.toContain("secret");
  });

  it("uses an honest fallback for empty or markdown-only input", () => {
    expect(buildReasoningPresentation("```ts\nnoop()\n```", true)).toEqual({
      title: "Planning next moves",
      steps: [],
      source: "fallback",
    });
    expect(buildReasoningPresentation("", false).title).toBe(
      "Reviewed approach",
    );
  });

  it("bounds long labels and removes generic numbered stage prefixes", () => {
    const result = buildReasoningPresentation(
      `## Step 2: ${"Detailed interaction analysis ".repeat(8)}`,
      true,
    );

    expect(result.title).not.toMatch(/^Step 2/i);
    expect(result.title.length).toBeLessThanOrEqual(72);
    expect(result.title.endsWith("…")).toBe(true);
  });
});
