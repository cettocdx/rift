"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The cinematic planet — a real 4K asset, not a canvas approximation.
 *
 * XScale used to draw its horizon with XAtmosphere, a canvas gradient. This is
 * the SpaceX move done properly: a photoreal planet limb, generated at 4K and
 * animated as a slow orbital drift, full-bleed behind the copy. It is honestly
 * decorative — a planet asserts nothing about infrastructure the company does
 * not own, which is the line the cut server-hall photograph crossed. It also
 * rhymes with the hero's three.js globe: the page opens on a world rendered in
 * real time and closes its argument on one filmed from orbit.
 *
 * Loading discipline, because this sits below the fold on a marketing page:
 *   • The <video> is inert until the section is near the viewport — no source
 *     is attached, so nothing downloads for a visitor who never scrolls here.
 *   • Under prefers-reduced-motion the video is never attached at all; the 4K
 *     still stands in, which is a composition in its own right.
 *   • The poster paints immediately, so there is no empty frame before the
 *     loop is buffered — the still and the first video frame are the same image.
 */
export function XPlanet({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) return;
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    // Attach sources only once in view, then load and play. Muted + playsInline
    // is what lets autoplay run on every browser including iOS Safari.
    el.load();
    const play = el.play();
    if (play) play.catch(() => {});
  }, [active]);

  return (
    <video
      ref={ref}
      className={className}
      poster="/landing-x/planet-poster.jpg"
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
    >
      {active ? (
        <>
          <source src="/landing-x/planet-loop.webm" type="video/webm" />
          <source src="/landing-x/planet-loop.mp4" type="video/mp4" />
        </>
      ) : null}
    </video>
  );
}
