export function isRetryableTerminalStartupError(error: unknown) {
  if (error && typeof error === "object" && "retryable" in error) {
    return (error as { retryable?: unknown }).retryable === true;
  }
  if (error instanceof TypeError) return true;
  return (
    error instanceof DOMException &&
    (error.name === "NetworkError" || error.name === "TimeoutError")
  );
}

export function terminalStartupRetryDelayMs(attempt: number) {
  return Math.min(350 * 2 ** Math.min(Math.max(attempt - 1, 0), 3), 3000);
}
