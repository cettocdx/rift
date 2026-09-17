"use client";

import {
  createContext,
  useContext,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * The page scrolls inside its own element, not the window.
 *
 * The app shell is a fixed-height surface, so a landing route gets a scroll
 * container of its own — which means `window.scrollY` never moves and anything
 * reading it silently does nothing. Both the hero parallax and the nav's
 * translucency depend on scroll position, so the container ref is published
 * here once and consumed by name rather than each component reaching for the
 * DOM and guessing.
 */

const ScrollContainerContext =
  createContext<RefObject<HTMLDivElement | null> | null>(null);

/** The element the page actually scrolls in. Null only outside the shell. */
export function useLandingScrollContainer() {
  return useContext(ScrollContainerContext);
}

export function LandingShell({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <ScrollContainerContext.Provider value={scrollRef}>
      <div id="top" ref={scrollRef} style={style} className={className}>
        {children}
      </div>
    </ScrollContainerContext.Provider>
  );
}
