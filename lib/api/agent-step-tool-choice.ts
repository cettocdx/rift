export type AgentStepToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; toolName: string }
  | undefined;

/**
 * Media Studio is the only surface with a forced opening tool: the user picked
 * an output modality, so the first step must produce it. Build deliberately
 * forces nothing — skill discovery is deterministic string matching that the
 * server already runs for free, so paying a model round trip for it wasted a
 * step on every request regardless of the selected model.
 */
export function resolveForcedFirstToolName(args: {
  purpose: "security" | "app" | "image";
  mediaKind?: "image" | "video" | null;
}): string | undefined {
  if (args.purpose === "image") {
    return args.mediaKind === "video" ? "generate_video" : "generate_image";
  }
  return undefined;
}

/** Pure policy used by both the initial call and every prepareStep pass. */
export function resolveAgentStepToolChoice(args: {
  forceFirstToolName?: string;
  completedSteps: number;
  buildCompletionRequired: boolean;
}): AgentStepToolChoice {
  if (args.forceFirstToolName && args.completedSteps === 0) {
    return { type: "tool", toolName: args.forceFirstToolName };
  }
  if (args.buildCompletionRequired && args.completedSteps > 0) {
    return "required";
  }
  if (args.forceFirstToolName) return "auto";
  return undefined;
}

const WEB_PREVIEW_TOOL_NAMES = new Set(["verify_app", "expose_preview"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * A web-preview request opts into verify + expose completion. Generic Build
 * tasks also include repository inspection, library/backend edits and media:
 * neither a terminal call nor a file write implies a runnable web app. Keep
 * those tasks free to finish with their own evidence, without forcing them
 * into an unrelated preview loop. Once opted in, failed verification keeps
 * the gate active until the existing proof/exposure checks succeed.
 */
export function stepsRequestWebPreview(steps: unknown[]): boolean {
  return steps.some((step) => {
    if (!isRecord(step) || !Array.isArray(step.toolCalls)) return false;
    return step.toolCalls.some((toolCall) => {
      if (!isRecord(toolCall) || typeof toolCall.toolName !== "string") {
        return false;
      }
      return WEB_PREVIEW_TOOL_NAMES.has(toolCall.toolName);
    });
  });
}
