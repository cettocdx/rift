export const PERSISTED_RUN_TIMEOUT_MESSAGE =
  "The run timed out while waiting for a service. Your message is saved. Retry to continue from the saved work.";
export const PERSISTED_RUN_FAILURE_MESSAGE =
  "The agent run failed. Your message and saved work are kept. Retry to continue; completed actions will not be blindly replayed.";

/** Persist only product-owned descriptions, never raw provider payloads or secrets. */
export function describeRunFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    /selected local runner|local runner relay|local runner could not be authorized/i.test(
      message,
    )
  ) {
    return "RIFT could not reach the selected local computer. Open RIFT Desktop on that computer and sign in with the same account to reconnect automatically, then retry. Your message is saved; no cloud fallback was started.";
  }
  if (/rate.?limit|too many requests|429/i.test(message)) {
    return "The run reached a usage or request limit. Check Monthly usage and retry when capacity is available. Your message is saved.";
  }
  if (/timeout|timed out/i.test(message)) {
    return PERSISTED_RUN_TIMEOUT_MESSAGE;
  }
  return PERSISTED_RUN_FAILURE_MESSAGE;
}
