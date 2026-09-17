"use client";

import { useEffect, useRef } from "react";

/**
 * air.dev's signature visual language: a matrix of dots that grow from radius 0
 * to their target with a spring-like ease when scrolled into view (SVG SMIL,
 * triggered once via IntersectionObserver → beginElement). Used as ambient
 * decoration and as the full-width closing "field" in the footer.
 *
 * Circles nearer the centre of the wave start slightly earlier (beginElementAt)
 * so the field blooms outward rather than snapping in all at once.
 */
export function DotField({
  cols = 16,
  rows = 8,
  gap = 30,
  radius = 3,
  color = "rgba(0,213,255,0.55)",
  className = "",
}: {
  cols?: number;
  rows?: number;
  gap?: number;
  radius?: number;
  color?: string;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const anims = svg.querySelectorAll("animate");
        anims.forEach((a) => {
          const begin = Number((a as SVGElement).dataset.begin ?? "0");
          const el = a as unknown as {
            beginElementAt?: (offset: number) => void;
            beginElement?: () => void;
          };
          if (el.beginElementAt) el.beginElementAt(begin);
          else el.beginElement?.();
        });
        io.disconnect();
      },
      { threshold: 0.25 },
    );
    io.observe(svg);
    return () => io.disconnect();
  }, []);

  const w = (cols - 1) * gap;
  const h = (rows - 1) * gap;
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const maxDist = Math.hypot(cx, cy) || 1;

  const dots: React.ReactNode[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      const begin = (dist / maxDist) * 0.7; // bloom outward
      dots.push(
        <circle key={`${x}-${y}`} cx={x * gap} cy={y * gap} r={0} fill={color}>
          <animate
            attributeName="r"
            values={`0;${radius}`}
            dur="1.3s"
            begin="indefinite"
            fill="freeze"
            calcMode="spline"
            keySplines="0.2 0 0.2 1"
            data-begin={begin}
          />
        </circle>,
      );
    }
  }

  return (
    <svg
      ref={ref}
      viewBox={`${-radius} ${-radius} ${w + radius * 2} ${h + radius * 2}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {dots}
    </svg>
  );
}
