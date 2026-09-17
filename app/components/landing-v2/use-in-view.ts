"use client";

import { useEffect, useRef, useState } from "react";

import { useLandingScrollContainer } from "./LandingShell";

/**
 * Fires once, when the element first reaches the screen.
 *
 * Every sequenced animation on this page needs the same thing: a signal that
 * the reader is actually looking, so the sequence plays under their eyes
 * rather than finishing before they arrive. Three separate components had
 * grown three slightly different versions of this, and two of them had the
 * same bug — an `IntersectionObserver` left on the default root.
 *
 * That bug is worth naming, because it has now cost this page twice. The
 * landing scrolls inside its own element rather than the document (see
 * LandingShell), so an observer on the default root watches a scroller that
 * never moves. Combined with fire-once semantics, the miss is permanent: the
 * element sits below the fold forever in its initial state, and the failure
 * looks like a rendering bug rather than a scroll-root one.
 *
 * `amount` is the fraction of the element that must be visible before it
 * counts. Small for tall things — a 700px product frame is never 50% visible
 * on a laptop — larger for a row of cards that should be fully arrived before
 * they start moving.
 *
 * ── Why it fails open ──
 *
 * Every caller uses this to hold content at a low opacity until it fires, so
 * a hook that never fires does not degrade the page — it deletes a section of
 * it. That is not hypothetical: reviewing the parallel landing in an
 * automated tab, `document.hidden` was true, the observer never reported, and
 * an entire wall of connector logos sat at 10% looking like fourteen broken
 * images. The logos were fine. The reveal never happened.
 *
 * So there is a backstop. If `IntersectionObserver` is missing the content is
 * revealed immediately, and if the observer simply never reports, a timer
 * reveals it anyway. Six seconds is chosen to be longer than any plausible
 * scroll to the next section and shorter than a reader's patience: the worst
 * case is one block that arrives without its entrance, which is a far smaller
 * failure than a block that never arrives.
 */

/** How long to wait for an observer that may never report. */
const FAIL_OPEN_MS = 6000;

export function useInViewOnce<T extends HTMLElement>(
  amount = 0.2,
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  const scrollContainer = useLandingScrollContainer();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const supported = typeof IntersectionObserver !== "undefined";

    // Scheduled rather than written in the effect body even in the
    // unsupported case: a synchronous state write here cascades a render
    // before paint, and this repo lints against it.
    const failOpen = setTimeout(
      () => setSeen(true),
      supported ? FAIL_OPEN_MS : 0,
    );

    if (!supported) return () => clearTimeout(failOpen);

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        clearTimeout(failOpen);
        setSeen(true);
      },
      { root: scrollContainer?.current ?? null, threshold: amount },
    );

    observer.observe(node);
    return () => {
      clearTimeout(failOpen);
      observer.disconnect();
    };
  }, [amount, scrollContainer]);

  return [ref, seen];
}
