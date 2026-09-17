/** Pure projection shared by live SDK tools and persisted chat reconstruction. */
export function projectPtyOutput(
  output: unknown,
  includeScrollback = false,
): unknown {
  if (!output || typeof output !== "object") return output;
  const result = (output as { result?: unknown }).result;
  if (!result || typeof result !== "object") return output;
  const {
    rawSnapshot: _raw,
    modelContext,
    ...rest
  } = result as Record<string, unknown>;
  if (!includeScrollback && modelContext && typeof modelContext === "object") {
    const context = modelContext as {
      screen?: unknown;
      scrollback?: { path?: unknown; characters?: unknown; scope?: unknown };
    };
    if (
      typeof context.screen === "string" &&
      typeof context.scrollback?.path === "string"
    ) {
      const { sessionSnapshot: _snapshot, ...compact } = rest;
      return {
        ...output,
        result: {
          ...compact,
          screen: context.screen,
          scrollback: context.scrollback,
        },
      };
    }
  }
  return { ...output, result: rest };
}

export function ptyModelOutput(
  output: unknown,
  includeScrollback = false,
): { type: "text"; value: string } {
  const projected = projectPtyOutput(output, includeScrollback);
  return {
    type: "text",
    value:
      projected !== null && typeof projected === "object"
        ? JSON.stringify(projected)
        : String(projected ?? ""),
  };
}
