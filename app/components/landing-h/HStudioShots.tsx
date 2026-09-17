import { RENDERERS } from "@/app/components/landing-x/x-mark-data";

import { H_LABEL } from "./h-system";

/**
 * Studio output on the bright page: four real generations, each tagged with the
 * model that made it. Two layouts from one source — a wide four-up contact
 * sheet, or a compact 2×2 that sits beside the live Build frame so the page
 * spreads sideways instead of stacking everything full-width.
 */
const SHOTS: { src: string; alt: string; model: string }[] = [
  {
    src: "/landing-x/studio/studio-perfume.webp",
    alt: "A dark cinematic perfume product shot on a dusk coastline",
    model: "Seedream 5.0 Pro",
  },
  {
    src: "/landing-x/studio/studio-portrait.webp",
    alt: "An editorial fashion portrait in dramatic rim light",
    model: "FLUX.2 Max",
  },
  {
    src: "/landing-x/studio/studio-watch.webp",
    alt: "A macro of a skeleton mechanical watch in warm light",
    model: "Nano Banana 2",
  },
  {
    src: "/landing-x/studio/studio-atrium.webp",
    alt: "A concrete and glass atrium at blue hour",
    model: "Gemini 3 Pro Image",
  },
];

const markFor = (name: string) =>
  RENDERERS.find((r) => r.name === name)?.Logo ?? null;

export function HStudioShots({
  columns = 4,
  label = "Made in Studio · four real generations",
}: {
  columns?: 2 | 4;
  label?: string | null;
}) {
  const grid = columns === 2 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4";
  return (
    <div>
      {label ? <p className={H_LABEL}>{label}</p> : null}
      <ul className={`grid gap-2.5 sm:gap-3 ${grid} ${label ? "mt-5" : ""}`}>
        {SHOTS.map((shot) => {
          const Logo = markFor(shot.model);
          return (
            <li
              key={shot.src}
              className="group relative overflow-hidden rounded-[4px] border border-white/10"
            >
              <div className="relative aspect-[4/5]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.src}
                  alt={shot.alt}
                  className="absolute inset-0 size-full object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-[linear-gradient(to_top,rgba(0,0,0,0.72),transparent)] px-2.5 pb-2.5 pt-8">
                  {Logo ? (
                    <Logo size={13} className="shrink-0 text-white" />
                  ) : null}
                  <span className="truncate text-[11px] font-medium text-white">
                    {shot.model}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
