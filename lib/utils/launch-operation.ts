// Bridge for launching an Operation (from the Arsenal launcher in the sidebar)
// into the active chat. The composer/send lives inside <Chat> (useChat), so the
// launcher dispatches an event and <Chat> sends it in agent mode. Mirrors the
// settings-dialog event pattern.

const EVENT_NAME = "rift:launch-operation";

export interface LaunchOperationDetail {
  /** Fully-built prompt to send. */
  prompt: string;
  /** Operation id, so the chat can show an active-operation badge (mode). */
  operationId: string;
  /** Human label for the active-operation badge. */
  operationLabel: string;
  /** Primary target (for the badge / saved targets), if any. */
  target?: string;
  /** Which chat mode to run the operation in. */
  mode: "agent" | "ask";
}

/** Fire from the launcher to start an operation in the active chat (agent mode). */
export function launchOperation(detail: LaunchOperationDetail) {
  window.dispatchEvent(
    new CustomEvent<LaunchOperationDetail>(EVENT_NAME, { detail }),
  );
}

/** Subscribe to operation launches. Returns a cleanup function. */
export function onLaunchOperation(
  callback: (detail: LaunchOperationDetail) => void,
): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<LaunchOperationDetail>).detail;
    if (detail) callback(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
