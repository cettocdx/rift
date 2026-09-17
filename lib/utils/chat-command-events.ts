export type ChatCommandAction = "fork" | "copy-last-output";

const EVENT = "rift:chat-command";

export function dispatchChatCommand(action: ChatCommandAction) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { action } }));
}

export function onChatCommand(
  callback: (action: ChatCommandAction) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const action = (event as CustomEvent<{ action?: unknown }>).detail?.action;
    if (action === "fork" || action === "copy-last-output") callback(action);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
