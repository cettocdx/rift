export type McpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
};

/** Build Plan fails closed unless an MCP tool explicitly declares read-only use. */
export function isMcpToolReadOnlyForPlan(
  annotations: McpToolAnnotations | undefined,
): boolean {
  return (
    annotations?.readOnlyHint === true && annotations.destructiveHint !== true
  );
}
