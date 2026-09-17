/**
 * Compatibility shim for old imports. Build uses the shared, model-independent
 * Rift harness unconditionally. Retired rollout flags cannot restore OpenCode.
 */
export type BuildEngine = "rift";
export function resolveBuildEngine(_input: {
  purpose: string | undefined;
  mode: string | undefined;
  userId: string;
  env?: Record<string, string | undefined>;
}): BuildEngine {
  return "rift";
}
