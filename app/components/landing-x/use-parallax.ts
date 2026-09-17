"use client";

import { useEffect, useRef } from "react";

/**
 * A subtle scroll parallax for the cinematic bands.
 *
 * The element drifts a fraction of the scroll distance, so a full-bleed image
 * reads as sitting *behind* the page rather than pasted onto it — the SpaceX
 * move. Kept small on purpose (a few dozen pixels at most); parallax is one of
 * the fastest ways to make a page feel cheap when it is overdone.
 *
 * Discipline, because this runs on scroll:
 *  - transform only (translate3d), so it stays on the compositor and never
 *    triggers layout;
 *  - one rAF per frame, coalesced — a scroll fires many events, this paints
 *    once;
 *  - gated by an IntersectionObserver and `document.hidden`, so nothing is
 *    computed while the band is off-screen or the tab is backgrounded (the
 *    same hidden-tab guard the globe and planet already use);
 *  - off entirely under prefers-reduced-motion.
 *
 * The element it is attached to must be oversized inside an `overflow-hidden`
 * parent, or the drift exposes an edge. `strengthPx` is the peak offset.
 */
export function useParallax<T extends HTMLElement>(strengthPx = 40) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let ticking = false;
    let visible = false;

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) schedule();
      },
      { rootMargin: "25% 0px 25% 0px" },
    );
    io.observe(el);

    const update = () => {
      ticking = false;
      if (!visible || document.hidden) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // −1 when the band's centre is a viewport below the middle, +1 a
      // viewport above; 0 when centred. Clamped so the offset never exceeds
      // strengthPx.
      const centre = rect.top + rect.height / 2;
      const progress = Math.max(
        -1,
        Math.min(1, (centre - vh / 2) / (vh / 2 + rect.height / 2)),
      );
      el.style.transform = `translate3d(0, ${(-progress * strengthPx).toFixed(1)}px, 0)`;
    };

    const schedule = () => {
      if (ticking) return;
      ticking = true;
      raf = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [strengthPx]);

  return ref;
}
