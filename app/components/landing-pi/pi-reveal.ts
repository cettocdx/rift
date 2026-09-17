/**
 * The page's one reveal: a staggered opacity transition, in classes only.
 *
 * ── Why classes and not a style prop ──
 *
 * These staggers were `style={{ transitionDelay, transitionTimingFunction }}`
 * and every element carrying one produced a React hydration mismatch: the
 * server serialises a style object to a CSS string, the browser reparses it,
 * and the two do not compare equal on either the property casing or the
 * whitespace inside `cubic-bezier(0.22, 1, 0.36, 1)`. The values were correct
 * and identical; only their spelling differed, and React reports that as a
 * tree that failed to hydrate.
 *
 * A class has no such round trip. It is the same six characters on both sides.
 *
 * ── Why a literal array and not a template ──
 *
 * Tailwind scans source text. `delay-[${n}ms]` is not text it can see, so it
 * generates no CSS and the stagger silently does nothing — a trap this repo
 * has hit before with arbitrary values. Every class below is written out in
 * full so the scanner finds it.
 */

/** One curve for the whole page, matching PI_EASE. */
export const REVEAL_EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";

/** 45ms a step. Fifteen steps is longer than any row of cells on the page. */
const DELAYS = [
  "delay-0",
  "delay-[45ms]",
  "delay-[90ms]",
  "delay-[135ms]",
  "delay-[180ms]",
  "delay-[225ms]",
  "delay-[270ms]",
  "delay-[315ms]",
  "delay-[360ms]",
  "delay-[405ms]",
  "delay-[450ms]",
  "delay-[495ms]",
  "delay-[540ms]",
  "delay-[585ms]",
  "delay-[630ms]",
] as const;

/** The stagger class for position `index`, clamped to the last step. */
export const revealDelay = (index: number) =>
  DELAYS[Math.min(Math.max(index, 0), DELAYS.length - 1)];
