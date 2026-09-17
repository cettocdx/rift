import {
  resolveForcedFirstToolName,
  resolveAgentStepToolChoice,
  stepsRequestWebPreview,
} from "../agent-step-tool-choice";

describe("Build agent tool-loop policy", () => {
  it("allows a planning-only first step to ask a real clarification", () => {
    expect(
      resolveAgentStepToolChoice({
        completedSteps: 0,
        buildCompletionRequired: false,
      }),
    ).toBeUndefined();
  });

  it("requires continued tool use after execution until preview completion", () => {
    expect(
      resolveAgentStepToolChoice({
        completedSteps: 2,
        buildCompletionRequired: true,
      }),
    ).toBe("required");
    expect(
      resolveAgentStepToolChoice({
        completedSteps: 3,
        buildCompletionRequired: false,
      }),
    ).toBeUndefined();
  });

  it("preserves forced first-tool behavior for Media Studio", () => {
    expect(
      resolveAgentStepToolChoice({
        forceFirstToolName: "generate_image",
        completedSteps: 0,
        buildCompletionRequired: false,
      }),
    ).toEqual({ type: "tool", toolName: "generate_image" });
    expect(
      resolveAgentStepToolChoice({
        forceFirstToolName: "generate_image",
        completedSteps: 1,
        buildCompletionRequired: false,
      }),
    ).toBe("auto");
  });

  it("never forces an opening tool on Build, so no step is spent on skill discovery", () => {
    expect(resolveForcedFirstToolName({ purpose: "app" })).toBeUndefined();
    expect(
      resolveAgentStepToolChoice({
        forceFirstToolName: undefined,
        completedSteps: 0,
        buildCompletionRequired: false,
      }),
    ).toBeUndefined();
  });

  it("keeps Media modality forcing and leaves Security unforced", () => {
    expect(
      resolveForcedFirstToolName({ purpose: "image", mediaKind: "image" }),
    ).toBe("generate_image");
    expect(
      resolveForcedFirstToolName({ purpose: "image", mediaKind: "video" }),
    ).toBe("generate_video");
    expect(resolveForcedFirstToolName({ purpose: "security" })).toBeUndefined();
  });

  it("continues tool use immediately after a forced opening tool", () => {
    expect(
      resolveAgentStepToolChoice({
        forceFirstToolName: "generate_image",
        completedSteps: 1,
        buildCompletionRequired: false,
      }),
    ).toBe("auto");
  });

  it("starts the completion gate only for an explicit web preview request", () => {
    expect(
      stepsRequestWebPreview([
        { toolCalls: [{ toolName: "verify_app", input: { port: 3000 } }] },
      ]),
    ).toBe(true);
    expect(
      stepsRequestWebPreview([
        { toolCalls: [{ toolName: "expose_preview", input: { port: 3000 } }] },
      ]),
    ).toBe(true);
    expect(
      stepsRequestWebPreview([
        { toolCalls: [{ toolName: "web_search", input: { query: "docs" } }] },
        { toolCalls: [{ toolName: "file", input: { action: "read" } }] },
      ]),
    ).toBe(false);
    expect(
      stepsRequestWebPreview([
        {
          toolCalls: [
            {
              toolName: "file",
              input: { action: "edit", path: "/app/src/App.tsx" },
            },
          ],
        },
      ]),
    ).toBe(false);
    expect(
      stepsRequestWebPreview([
        { toolCalls: [{ toolName: "run_terminal_cmd", input: {} }] },
      ]),
    ).toBe(false);
  });
});
