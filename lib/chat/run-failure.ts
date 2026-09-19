export const PERSISTED_RUN_TIMEOUT_MESSAGE =
  "The run timed out while waiting for a service. Your message is saved. Retry to continue from the saved work.";
export const PERSISTED_RUN_FAILURE_MESSAGE =
  "The agent run failed. Your message and saved work are kept. Retry to continue; completed actions will not be blindly replayed.";
export const PERSISTED_SANDBOX_FAILURE_MESSAGE =
  "The coding sandbox could not start, so the task could not run its tools. This is usually a temporary capacity issue — retry in a moment. Your message is saved.";
export const PERSISTED_MODEL_FAILURE_MESSAGE =
  "The selected model could not process this request. Retry, or switch to a different model, then try again. Your message is saved.";

/** HTTP-ish status code carried on AI SDK / provider error objects. */
function statusCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.statusCode === "number") return record.statusCode;
  if (typeof record.status === "number") return record.status;
  const data = record.data;
  if (data && typeof data === "object" && "error" in data) {
    const nested = (data as Record<string, unknown>).error;
    if (nested && typeof nested === "object") {
      const code = (nested as Record<string, unknown>).code;
      if (typeof code === "number") return code;
    }
  }
  return undefined;
}

const PROVIDER_ERROR_STATUS = new Set([400, 402, 403, 404, 500, 502, 503, 504]);

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
  // A sandbox/E2B boot failure means tools could not run at all — surface a
  // retryable, actionable message instead of the opaque generic one so the
  // user knows the cause is the coding environment, not their prompt.
  if (
    /failed creating persistent sandbox|sandbox authentication|\be2b\b|sandbox (?:is )?(?:unavailable|could not|failed|timed out|not found)|no sandbox template|sandbox template/i.test(
      message,
    )
  ) {
    return PERSISTED_SANDBOX_FAILURE_MESSAGE;
  }
  // A provider/model rejection (e.g. a model that cannot use tools, or an
  // upstream 4xx/5xx) is recoverable by retrying or switching models. Detect it
  // by the transport status or well-known provider phrasing, never by echoing
  // the raw upstream text.
  const status = statusCodeOf(error);
  if (
    (status !== undefined && PROVIDER_ERROR_STATUS.has(status)) ||
    /no endpoints found|does not support tool|no allowed providers|not a valid model|unsupported.*(?:tool|function)|provider returned error|invalid model/i.test(
      message,
    )
  ) {
    return PERSISTED_MODEL_FAILURE_MESSAGE;
  }
  return PERSISTED_RUN_FAILURE_MESSAGE;
}
