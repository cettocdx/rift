"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The page's scroll entrance. Hermeus reveals its text with a motion-blur
 * settle as each block clears the fold; this is the clean equivalent — a 10px
 * rise on the expo-out curve, once, with the same fail-open discipline the x
 * landing uses so a backgrounded or bfcache-restored tab can never strand a
 * section at zero opacity. Reduced motion resolves to settled via globals.
 */
const FAIL_OPEN_MS = 6000;

export function HReveal({
  children,
  className,
  delayMs = 0,
  id,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        clearTimeout(failOpen);
        setSeen(true);
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    io.observe(node);
    return () => {
      clearTimeout(failOpen);
      io.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      data-landing-reveal
      style={{ transitionDelay: seen ? `${delayMs}ms` : "0ms" }}
      className={`transition-[opacity,transform] duration-[680ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
        seen ? "translate-y-0 opacity-100" : "translate-y-[10px] opacity-0"
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
