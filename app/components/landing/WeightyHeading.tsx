"use client";

import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";

/**
 * air.dev's signature micro-interaction: a heading whose variable-font weight
 * animates as it scrolls through the viewport — hairline-thin when it first
 * appears from the bottom, thickening to bold as it rises. Requires a variable
 * font with a continuous `wght` axis (Montserrat is loaded variable in layout).
 *
 * Works inside a scroll container (not just window): we listen for scroll in
 * the CAPTURE phase on window, which catches the non-bubbling scroll events
 * fired by any descendant scroll container.
 */
export function WeightyHeading({
  as = "h2",
  min = 340,
  max = 700,
  className = "",
  children,
}: {
  as?: ElementType;
  min?: number;
  max?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [w, setW] = useState(min);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // Defer out of the effect body (avoid a synchronous setState-in-effect).
      const id = requestAnimationFrame(() => setW(Math.round((min + max) / 2)));
      return () => cancelAnimationFrame(id);
    }

    let raf = 0;
    const compute = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top;
      const vh = window.innerHeight;
      const upper = 160; // above this line → fully bold
      const lower = vh - 120; // below this line → thinnest
      let nw: number;
      if (top >= lower) nw = min;
      else if (top > upper)
        nw = min + ((lower - top) / (lower - upper)) * (max - min);
      else nw = max;
      setW(Math.round(nw));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };

    // Defer the initial measurement to the next frame so the effect body never
    // calls setState synchronously.
    raf = requestAnimationFrame(compute);
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [min, max]);

  const Tag = as;
  return (
    <Tag
      ref={ref}
      style={{
        fontWeight: w,
        fontVariationSettings: `'wght' ${w}`,
        transition:
          "font-weight 0.12s linear, font-variation-settings 0.12s linear",
      }}
      className={className}
    >
      {children}
    </Tag>
  );
}
