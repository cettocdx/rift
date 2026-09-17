"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The RIFT machine — a real 4K product film, not a rendered primitive.
 *
 * Not a computer case: a levitating, next-generation compute core that looks
 * like it arrived from somewhere further along than we are. A white-blue plasma
 * core suspended inside a gyroscopic cage of machined-titanium rings, generated
 * at 4K via Higgsfield and then filmed — the rings turning, the core breathing
 * and throwing filaments of light, the whole machine hovering over a bright
 * studio floor. A machine you watch working.
 *
 * The video is inert until near the viewport — no source attaches, so nothing
 * downloads for a visitor who never scrolls here — and under reduced motion the
 * 4K still stands in. The poster is a running frame, so the first paint is
 * already the core lit, never an empty box. A soft radial mask fades the frame's
 * pale studio edges into the page so the machine reads as floating on the
 * ground rather than sitting in a visible rectangle.
 */
const EDGE_MASK =
  "radial-gradient(116% 116% at 53% 46%, #000 58%, transparent 84%)";

export function HMachineMedia({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
    el.load();
    const play = el.play();
    if (play) play.catch(() => {});
  }, [active]);

  return (
    <video
      ref={ref}
      className={className}
      style={{ WebkitMaskImage: EDGE_MASK, maskImage: EDGE_MASK }}
      poster="/landing-h/machine-poster.webp"
      muted
      loop
      playsInline
      preload="none"
      aria-label="The RIFT machine — a levitating plasma-core AI compute unit, its gyroscopic rings turning as it runs"
    >
      {active ? (
        <source src="/landing-h/machine-loop.mp4" type="video/mp4" />
      ) : null}
    </video>
  );
}
