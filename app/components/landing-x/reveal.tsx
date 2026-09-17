"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The page's one scroll entrance, so every section arrives the same way.
 *
 * ── Measured, not guessed ──
 *
 * gumloop.com runs no motion library at all — `data-framer-name` returns zero
 * across the document. Its entrances are plain CSS transitions on inline
 * styles, and the recipe is visible on any element still below the fold:
 *
 *     filter: blur(2px); opacity: 0; transform: translateY(8px)
 *       →  blur(0px); opacity: 1; transform: none
 *
 * over `0.5s cubic-bezier(0.77, 0, 0.175, 1)` — easeInOutQuart, 82 elements
 * carrying that exact pair. A second, louder variant exists for one hero
 * element (`blur(4px)` with `scale(0.25)`), and everything else on the page is
 * hover at 0.15s.
 *
 * So blur *is* the device, which is worth saying because the version this
 * replaces also blurred — at 10px over 14px of travel across 820ms, tuned for
 * orchid.ai. Every one of those three numbers was roughly four times what the
 * reference uses. The difference between the two is not stylistic: a 10px
 * defocus on a full-width application window is a compositor-expensive effect
 * a reader actually waits out, and a 2px one is a settle they only feel.
 *
 * ── The two faults designed out, kept from the previous version ──
 *
 *  - It fails *open*. A `whileInView`/`once` reveal has no backstop: a
 *    bfcache restore, a tab backgrounded at load, or a throttled observer
 *    leaves the element at opacity 0 permanently — not degraded, gone. So a
 *    6s timer reveals the content regardless, and a missing Intersection
 *    Observer reveals it immediately.
 *  - It is class/attribute-driven, not Motion, so the markup is identical on
 *    both sides of hydration and the reduced-motion preference is answered by
 *    a media query in globals (the one place that can see it), never by a
 *    server guess that mismatches the client. That rule now clears `filter`
 *    as well as transform and opacity — without it, reduced motion would have
 *    pinned every block at blur(10px) permanently, which is worse than the
 *    animation by a wide margin.
 *
 * landing-x scrolls the document, so the observer roots on null.
 */

const FAIL_OPEN_MS = 6000;

function useInViewOnce<T extends HTMLElement>(
  amount = 0.15,
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const supported = typeof IntersectionObserver !== "undefined";
    const failOpen = setTimeout(
      () => setSeen(true),
      supported ? FAIL_OPEN_MS : 0,
    );
    if (!supported) return () => clearTimeout(failOpen);

    /*
     * Anything already on screen at mount is revealed at once, without waiting
     * for the observer's threshold.
     *
     * The threshold exists to start a block settling as it clears the fold,
     * which is the right rule for a reader scrolling down. It is the wrong
     * rule for a reader who arrived at `/#connect` from another page's
     * navigation: the section is right there in front of them, but only a
     * sliver of a tall block is inside the viewport, so 15% is never reached
     * and nothing appears until the six-second backstop fires. What they see
     * in the meantime is a blank screen with a divider in it.
     *
     * A plain rect overlap answers "is this on screen right now", which is the
     * actual question at mount. Scrolling behaviour is untouched — a block
     * below the fold fails this check and goes on to the observer.
     */
    const rect = node.getBoundingClientRect();
    const onScreen = rect.top < window.innerHeight && rect.bottom > 0;
    if (onScreen) {
      // Scheduled, not set inline: this repo lints against setting state in an
      // effect body, and a frame's delay is invisible at mount.
      const immediate = setTimeout(() => setSeen(true), 0);
      return () => {
        clearTimeout(immediate);
        clearTimeout(failOpen);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        clearTimeout(failOpen);
        setSeen(true);
      },
      // A touch before the block is fully in view, so it is already settling
      // as it clears the fold rather than starting once it has arrived.
      { root: null, rootMargin: "0px 0px -8% 0px", threshold: amount },
    );
    observer.observe(node);
    return () => {
      clearTimeout(failOpen);
      observer.disconnect();
    };
  }, [amount]);

  return [ref, seen];
}

/*
 * Literal delay tables — Tailwind scans source text, so an interpolated
 * `delay-[${n}ms]` compiles to no CSS and the stagger silently does nothing.
 */
/** easeInOutQuart — the curve under all 82 of their 0.5s transitions. */
const REVEAL_EASE = "ease-[cubic-bezier(0.77,0,0.175,1)]";
const STEP = [
  "delay-0",
  "delay-[90ms]",
  "delay-[180ms]",
  "delay-[270ms]",
  "delay-[360ms]",
  "delay-[450ms]",
] as const;
const stepClass = (i: number) =>
  STEP[Math.min(Math.max(i, 0), STEP.length - 1)];

/** Theirs: 500ms on easeInOutQuart. */
const DURATION = "duration-500";

/** Theirs, exactly: 2px of defocus over 8px of travel. */
const HIDDEN = "opacity-0 blur-[2px] translate-y-[8px]";
const SHOWN = "opacity-100 blur-0 translate-y-0";

/**
 * Reveal a block on first view. `step` is a stagger index (0,1,2…), not ms,
 * so a section's eyebrow / heading / lede arrive as a short sequence.
 */
export function Reveal({
  children,
  step = 0,
  className,
}: {
  children: ReactNode;
  step?: number;
  className?: string;
}) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-landing-reveal
      // No `will-change`. It was here to smooth a 10px blur; at 2px there is
      // nothing to smooth, and hinting it would promote every unrevealed block
      // on the page to its own compositor layer at once for no gain.
      className={`${className ?? ""} transition-[opacity,transform,filter] ${DURATION} ${REVEAL_EASE} ${stepClass(
        step,
      )} ${seen ? SHOWN : HIDDEN}`}
    >
      {children}
    </div>
  );
}
