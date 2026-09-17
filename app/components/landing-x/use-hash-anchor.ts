"use client";

import { useEffect } from "react";

/**
 * Re-scroll to the URL's hash once the page has stopped growing.
 *
 * ── The failure this fixes ──
 *
 * The bar and the footer on every interior page link into the landing's
 * sections — `/#build`, `/#workbench`, `/#connect`. Following one of those
 * puts the browser's anchor scroll in a race it loses: it measures the target's
 * offset while the page is still short, because several sections below the
 * fold mount a live application window, a canvas or a full-bleed image after
 * hydration. Every one of those adds height *above* the target after the jump
 * has already happened, so the reader lands somewhere further up the document
 * than they asked for — in the worst case, in the whitespace under the footer.
 *
 * Waiting a fixed number of milliseconds would be a guess. This watches the
 * document height instead and re-anchors once it has been stable for two
 * frames, giving up after a bounded number of attempts so a page that never
 * settles (an animating canvas that reports a changing height) cannot keep
 * yanking the viewport out from under someone who has started reading.
 *
 * `scrollIntoView` rather than a computed `scrollTo`, so the section's own
 * `scroll-mt` — which clears the fixed bar — is honoured.
 */

/** Enough to cover the heaviest section mounting, not enough to fight a reader. */
const MAX_FRAMES = 90;

export function useHashAnchor() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;

    let frames = 0;
    let stable = 0;
    let lastHeight = -1;
    let raf = 0;
    /* A reader who scrolls has taken over; stop moving the page under them. */
    let cancelled = false;
    const release = () => {
      cancelled = true;
    };
    window.addEventListener("wheel", release, { passive: true, once: true });
    window.addEventListener("touchstart", release, { passive: true, once: true });
    window.addEventListener("keydown", release, { once: true });

    const tick = () => {
      if (cancelled || frames++ > MAX_FRAMES) return;
      const height = document.documentElement.scrollHeight;
      if (height === lastHeight) {
        stable += 1;
      } else {
        stable = 0;
        lastHeight = height;
      }
      if (stable >= 2) {
        document.getElementById(id)?.scrollIntoView({ block: "start" });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchstart", release);
      window.removeEventListener("keydown", release);
    };
  }, []);
}
