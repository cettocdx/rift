/**
 * Identity of the conversation the URL is currently pointing at.
 *
 * Chat syncs its local state from the URL, and that sync is not idempotent: on
 * "/" it mints a fresh chat id. React re-runs a mounted effect with unchanged
 * dependencies whenever the subtree is torn down and restored — StrictMode's
 * double-invoke, and a suspend/resume — so the sync has to be able to tell "the
 * URL changed" from "this effect ran again". Comparing this key does that.
 *
 * Without it, a submit could re-run the sync, rebind useChat to a new id, and
 * drop the user's just-sent message while the run continued server-side under
 * the original id.
 */
export function chatRouteKey(
  pathname: string,
  routeChatId?: string | null,
): string {
  return `${pathname}::${routeChatId ?? ""}`;
}

type NewChatRouteOutcome = {
  isExistingChat: boolean;
  isTemporaryChat: boolean;
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
};

/**
 * A new turn must keep its current page mounted while useChat owns the live
 * transport. The durable chat route is safe only after a successful finish;
 * aborts and failures need to retain the optimistic user message and recovery
 * controls on the current page.
 */
export function shouldPromoteNewChatRoute({
  isExistingChat,
  isTemporaryChat,
  isAbort,
  isDisconnect,
  isError,
}: NewChatRouteOutcome): boolean {
  return (
    !isExistingChat && !isTemporaryChat && !isAbort && !isDisconnect && !isError
  );
}
