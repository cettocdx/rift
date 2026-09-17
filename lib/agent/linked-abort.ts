/** Keep the worker's independently abortable model controller tied to Trigger. */
export function linkAgentAbortSignal(signal: AbortSignal) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", forwardAbort, { once: true });
  // Abort events are not replayed for listeners attached after slow setup.
  if (signal.aborted) forwardAbort();
  return {
    controller,
    dispose: () => signal.removeEventListener("abort", forwardAbort),
  };
}
