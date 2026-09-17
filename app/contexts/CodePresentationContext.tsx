"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import type { ChatViewState } from "./ChatViewStateContext";

export type CodePresentationReceipt = { source: string; wrapped: boolean };
const MAX_ENTRIES = 64;
const MAX_SOURCE_CHARACTERS = 262_144;
const View = createContext<ChatViewState | undefined>(undefined);
const Scope = createContext<string | undefined>(undefined);

export function CodePresentationProvider({
  view,
  children,
}: {
  view?: ChatViewState;
  children: ReactNode;
}) {
  return <View.Provider value={view}>{children}</View.Provider>;
}
export function CodePresentationScope({
  identity,
  children,
  requireParent = false,
}: {
  identity?: string;
  children: ReactNode;
  requireParent?: boolean;
}) {
  const parent = useContext(Scope);
  const value =
    identity === undefined || (requireParent && parent === undefined)
      ? undefined
      : JSON.stringify([parent ?? null, identity]);
  return <Scope.Provider value={value}>{children}</Scope.Provider>;
}
export function useCodePresentationIdentity() {
  return useContext(Scope);
}

function remember(
  view: ChatViewState | undefined,
  key: string | undefined,
  source: string,
  wrapped: boolean,
) {
  if (!view || !key) return;
  const entries = (view.codePresentation ??= new Map());
  entries.delete(key);
  if (source.length <= MAX_SOURCE_CHARACTERS)
    entries.set(key, { source, wrapped });
  let characters = 0;
  for (const receipt of entries.values()) characters += receipt.source.length;
  while (entries.size > MAX_ENTRIES || characters > MAX_SOURCE_CHARACTERS) {
    const oldest = entries.keys().next().value!;
    characters -= entries.get(oldest)!.source.length;
    entries.delete(oldest);
  }
}

/** Exact source lineage, memory-only. Append-only streaming keeps the preference;
 * replaced code, block identity and account/view changes cannot inherit it. */
export function useCodeWrapping(key: string | undefined, source: string) {
  const view = useContext(View);
  const restored = () => {
    const receipt = key ? view?.codePresentation?.get(key) : undefined;
    return receipt && source.startsWith(receipt.source)
      ? receipt.wrapped
      : false;
  };
  const [state, setState] = useState(() => ({
    view,
    key,
    source,
    wrapped: restored(),
    chosen: key ? (view?.codePresentation?.has(key) ?? false) : false,
  }));
  let current = state;
  // Without a user choice there is no revision to retain. Avoid an extra
  // state reconciliation render on every token of an untouched code block.
  if (
    state.view !== view ||
    state.key !== key ||
    (state.chosen && state.source !== source)
  ) {
    const append =
      state.view === view &&
      state.key === key &&
      source.startsWith(state.source);
    current = {
      view,
      key,
      source,
      wrapped: append ? state.wrapped : restored(),
      chosen: append
        ? state.chosen
        : key
          ? (view?.codePresentation?.has(key) ?? false)
          : false,
    };
    setState(current);
  }
  useLayoutEffect(() => {
    if (current.chosen) remember(view, key, source, current.wrapped);
  }, [view, key, source, current.chosen, current.wrapped]);
  const toggle = () => {
    const wrapped = !current.wrapped;
    remember(view, key, source, wrapped);
    setState({ view, key, source, wrapped, chosen: true });
  };
  return [current.wrapped, toggle] as const;
}
