import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "app/components/landing-v2");
const source = readFileSync(join(DIR, "Reveal.tsx"), "utf8");
const hook = readFileSync(join(DIR, "use-in-view.ts"), "utf8");
const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/**
 * The file with its prose removed.
 *
 * These assertions are about what the component *does*, and the component's
 * own comments explain at length what it deliberately no longer does — they
 * name `whileInView`, `useReducedMotion` and the interpolated delay class as
 * the exact mistakes being avoided. Matching against the raw file therefore
 * fails on the documentation of the fix, which is the least useful possible
 * test failure.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * A reveal must never be able to hide content permanently.
 *
 * Four failures have been found on the rendered page, all of which left real
 * copy at opacity 0 with no way back:
 *
 *  1. The viewport observer watched the browser viewport, but this page scrolls
 *     inside its own element. Sections reached the middle of the screen still
 *     invisible, and `once: true` made the miss permanent — seven elements were
 *     measured stuck in view, including the whole model vendor row.
 *
 *  2. Under `prefers-reduced-motion` the component still started at opacity 0
 *     and waited for that same observer. A preference for less movement turned
 *     into a blank page.
 *
 *  3. `whileInView` has no backstop at all. Reviewing the page in a
 *     backgrounded tab, where the observer simply never reported, the hero's
 *     input and the entire product frame below it sat invisible.
 *
 *  4. Branching the markup on `useReducedMotion()` produced a hydration
 *     mismatch on every element that did it, because a server cannot answer
 *     that question and picks the opposite answer to the browser.
 *
 * The implementation changed to close all four; these assertions changed with
 * it, and are written against the *guarantees* rather than the mechanism, so
 * they keep meaning something if the mechanism moves again.
 *
 * All four are the kind of bug that passes review and every rendering test,
 * because the markup is correct and only the result is wrong.
 */
describe("Reveal cannot strand content", () => {
  it("delegates the observer to the one hook that resolves the scroll root", () => {
    // The root itself is guarded by scroll-root-contract.test.ts. What matters
    // here is that this file does not grow its own observer beside it.
    expect(code).toContain("useInViewOnce");
    expect(code).not.toContain("new IntersectionObserver");
    expect(code).not.toContain("whileInView");
  });

  it("keeps a fail-open timer behind every reveal", () => {
    // Without this, an observer that never reports hides the content forever.
    expect(hook).toContain("FAIL_OPEN_MS");
    expect(hook).toMatch(/setTimeout\(\s*\(\) => setSeen\(true\)/);
  });

  it("renders one markup for everybody, so the tree can hydrate", () => {
    // No server/client branch on a preference the server cannot observe.
    expect(code).not.toContain("useReducedMotion");
  });

  it("resolves reduced motion to settled, never to hidden", () => {
    const rule = globals.slice(
      globals.indexOf("@media (prefers-reduced-motion: reduce)", globals.indexOf("[data-landing-reveal]") - 400),
    );
    expect(globals).toContain("[data-landing-reveal]");
    expect(rule).toContain("opacity: 1 !important");
  });

  it("still marks every reveal so the no-script fallback can reach it", () => {
    // MergedLanding ships a <noscript> rule keyed to this attribute.
    expect(code.match(/data-landing-reveal/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("writes its stagger classes out in full so Tailwind can see them", () => {
    // `delay-[${n}ms]` is not text the scanner can find; it generates no CSS
    // and the stagger silently does nothing.
    expect(code).not.toMatch(/delay-\[\$\{/);
    expect(code).toMatch(/"delay-\[\d+ms\]"/);
  });
});
