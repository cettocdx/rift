"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the modifier key should be drawn as ⌘ or as Ctrl.
 *
 * Read through useSyncExternalStore rather than useEffect so the server and
 * the first client render agree on "not a Mac" and the label settles in one
 * commit instead of flashing the wrong glyph.
 */
const subscribe = () => () => {};
const getSnapshot = () =>
  typeof navigator !== "undefined" &&
  /macintosh|mac os x/i.test(navigator.userAgent);
const getServerSnapshot = () => false;

export function useIsMac(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
