"use client";

import { useCallback, useEffect, useState } from "react";
import { chatIdFromPathname } from "@/lib/navigation/chat-routes";

export type TerminalDockView = "agent" | "terminal";
type Presentation = { open: boolean; view: TerminalDockView };
type SavedPresentation = Presentation & { pathname: string };
type ScopedPresentation = SavedPresentation & {
  accountId: string | null | undefined;
  ready: boolean;
  lastPathname: string;
};
const CLOSED: SavedPresentation = { open: false, view: "agent", pathname: "" };

function isSettingsPath(pathname: string) {
  return /^(?:\/workspace|\/lab\/app)?\/settings(?:\/|$)/.test(pathname);
}

function isDirectPromotion(
  saved: SavedPresentation,
  previousPath: string,
  pathname: string,
) {
  return (
    !isSettingsPath(previousPath) &&
    saved.pathname === previousPath &&
    chatIdFromPathname(previousPath) === null &&
    chatIdFromPathname(pathname) !== null
  );
}

export function terminalDockPresentationKey(accountId: string) {
  return `rift:terminal-presentation:v1:${encodeURIComponent(accountId)}`;
}

function readPresentation(accountId: string | null): SavedPresentation {
  if (!accountId || typeof window === "undefined") return CLOSED;
  try {
    const raw = window.sessionStorage.getItem(
      terminalDockPresentationKey(accountId),
    );
    if (!raw) return CLOSED;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return CLOSED;
    const saved = value as Record<string, unknown>;
    if (
      saved.version !== 1 ||
      typeof saved.pathname !== "string" ||
      saved.pathname.length > 2048 ||
      typeof saved.open !== "boolean" ||
      (saved.view !== "agent" && saved.view !== "terminal")
    )
      return CLOSED;
    return {
      pathname: saved.pathname,
      open: saved.open,
      view: saved.view,
    };
  } catch {
    return CLOSED;
  }
}

/** Only presentation is stored: never terminal output, grants, filesystem paths or tool snapshots. */
export function useTerminalDockPresentation(
  accountId: string | null | undefined,
  pathname: string,
) {
  const [state, setState] = useState<ScopedPresentation>({
    ...CLOSED,
    accountId: undefined,
    ready: false,
    lastPathname: pathname,
  });
  // Settings temporarily hides the dock without changing the last app route's
  // preference. Keeping that route in storage also survives a Settings reload.
  useEffect(() => {
    // Hydrate the external sessionStorage snapshot after auth/route resolution.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((previous) => {
      if (accountId === undefined)
        return { ...previous, lastPathname: pathname };
      const hydrated = previous.ready && previous.accountId === accountId;
      const saved = hydrated ? previous : readPresentation(accountId);
      if (isSettingsPath(pathname))
        return { ...saved, accountId, ready: true, lastPathname: pathname };
      const promotion =
        hydrated && isDirectPromotion(saved, previous.lastPathname, pathname);
      return {
        ...saved,
        pathname,
        open: saved.open && (saved.pathname === pathname || promotion),
        accountId,
        ready: true,
        lastPathname: pathname,
      };
    });
  }, [accountId, pathname]);

  const current = state.ready && state.accountId === accountId ? state : CLOSED;
  const visible =
    !isSettingsPath(pathname) &&
    current.open &&
    (current.pathname === pathname ||
      isDirectPromotion(current, state.lastPathname, pathname));
  useEffect(() => {
    if (
      !accountId ||
      !state.ready ||
      state.accountId !== accountId ||
      !state.pathname
    )
      return;
    try {
      window.sessionStorage.setItem(
        terminalDockPresentationKey(accountId),
        JSON.stringify({
          version: 1,
          pathname: state.pathname,
          open: state.open,
          view: state.view,
        }),
      );
    } catch {
      /* The dock remains usable when storage is unavailable. */
    }
  }, [accountId, state]);

  const setOpen = useCallback(
    (open: boolean | ((previous: boolean) => boolean)) => {
      if (accountId === undefined || isSettingsPath(pathname)) return;
      setState((previous) => {
        const base = previous.accountId === accountId ? previous : CLOSED;
        return {
          ...base,
          accountId,
          ready: true,
          pathname,
          lastPathname: pathname,
          open: typeof open === "function" ? open(base.open) : open,
        };
      });
    },
    [accountId, pathname],
  );
  const setView = useCallback(
    (view: TerminalDockView) => {
      if (accountId === undefined || isSettingsPath(pathname)) return;
      setState((previous) => ({
        ...(previous.accountId === accountId ? previous : CLOSED),
        accountId,
        ready: true,
        pathname,
        lastPathname: pathname,
        view,
      }));
    },
    [accountId, pathname],
  );
  const toggle = useCallback(() => setOpen((open) => !open), [setOpen]);
  return { open: visible, view: current.view, setOpen, setView, toggle };
}
