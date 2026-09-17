// Bridge into the active chat. A dispatched DOM event is not evidence that
// the chat accepted a message: callers receive an explicit local acknowledgement.
const EVENT_NAME = "rift:submit-message";

export interface SubmitMessageDetail {
  text: string;
  claim?: () => boolean;
  acknowledge?: (accepted: boolean) => void;
}

/** Resolves at local queue/transport acceptance, not agent completion. */
export function submitChatMessage(text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed || typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    let claimed = false;
    window.dispatchEvent(
      new CustomEvent<SubmitMessageDetail>(EVENT_NAME, {
        detail: {
          text: trimmed,
          claim: () => {
            if (claimed) return false;
            claimed = true;
            return true;
          },
          acknowledge: resolve,
        },
      }),
    );
    if (!claimed) resolve(false);
  });
}

/** The active chat owns acceptance; duplicate listeners cannot send twice. */
export function onSubmitChatMessage(
  callback: (text: string) => boolean | void | Promise<boolean | void>,
): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<SubmitMessageDetail>).detail;
    if (!detail?.text || (detail.claim && !detail.claim())) return;
    try {
      Promise.resolve(callback(detail.text)).then(
        (accepted) => detail.acknowledge?.(accepted === true),
        () => detail.acknowledge?.(false),
      );
    } catch {
      detail.acknowledge?.(false);
    }
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
