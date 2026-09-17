import { RENDERERS } from "./x-mark-data";
import { X_CAPTION, X_LABEL } from "./x-system";

/**
 * The Studio showcase — what the models actually make, the way x.ai's Imagine
 * card shows its output.
 *
 * The pictures used to sit as four equal tiles in a hard-bordered row, which
 * boxed them and threw away the fact that two are portraits and two are
 * landscapes. They are the product's whole argument here, so they get the room:
 * an unboxed mosaic — the two portraits standing full height beside the two
 * wide shots stacked — bleeding to the section width with only a soft radius and
 * a small maker's mark, no frame around each one.
 *
 * Underneath, the full roster as a clean tile grid — bigger logos, evenly laid
 * — so the section carries both the proof (the pictures) and the range (the
 * models) without either crowding the other.
 */

/** Four real generations, each attributed to a roster model. */
const GALLERY: { src: string; alt: string; model: string; wide?: boolean }[] = [
  {
    src: "/landing-x/studio/studio-perfume.webp",
    alt: "A black glass perfume bottle on wet stone at a dusk coastline",
    model: "Seedream 5.0 Pro",
  },
  {
    src: "/landing-x/studio/studio-portrait.webp",
    alt: "A cinematic editorial fashion portrait in dramatic rim light",
    model: "FLUX.2 Max",
  },
  {
    src: "/landing-x/studio/studio-watch.webp",
    alt: "A macro shot of a skeleton mechanical watch in a shaft of warm light",
    model: "Nano Banana 2",
    wide: true,
  },
  {
    src: "/landing-x/studio/studio-atrium.webp",
    alt: "A minimalist concrete and glass atrium at blue hour",
    model: "Gemini 3 Pro Image",
    wide: true,
  },
];

/** The mosaic cell spans: portraits stand full height, wides stack on the side. */
const CELL: Record<string, string> = {
  "studio-perfume": "aspect-[4/5] lg:aspect-auto lg:col-span-1 lg:row-span-2",
  "studio-portrait": "aspect-[4/5] lg:aspect-auto lg:col-span-1 lg:row-span-2",
  "studio-watch": "col-span-2 aspect-[16/10] lg:aspect-auto lg:col-span-1 lg:row-span-1",
  "studio-atrium": "col-span-2 aspect-[16/10] lg:aspect-auto lg:col-span-1 lg:row-span-1",
};

const key = (src: string) => src.split("/").pop()!.replace(".webp", "");

const markFor = (name: string) =>
  RENDERERS.find((r) => r.name === name)?.Logo ?? null;

export function XStudioGallery() {
  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <p className={X_LABEL}>Made in Studio</p>
        <p className={`${X_CAPTION} mt-3 max-w-[46ch]`}>
          Four real generations, one prompt box. Each rendered by the roster
          model that suits the shot.
        </p>
      </div>

      {/* The mosaic — unboxed, portraits tall, wides stacked. */}
      <ul className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 lg:h-[560px] lg:grid-cols-3 lg:grid-rows-2">
        {GALLERY.map((shot) => {
          const Logo = markFor(shot.model);
          return (
            <li
              key={shot.src}
              className={`group relative overflow-hidden rounded-[14px] ${CELL[key(shot.src)]}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shot.src}
                alt={shot.alt}
                width={1040}
                height={1300}
                loading="eager"
                decoding="sync"
                className="absolute inset-0 size-full object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 backdrop-blur-sm">
                {Logo ? (
                  <Logo size={14} className="shrink-0 text-white" />
                ) : null}
                <span className="text-[11px] font-medium tracking-[-0.01em] text-white">
                  {shot.model}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* The full roster — a clean tile grid, bigger logos, evenly laid. */}
      <div className="mt-16">
        <p className={`${X_LABEL} text-center`}>
          The roster · {RENDERERS.length} models
        </p>
        <ul className="mx-auto mt-8 grid max-w-[1040px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {RENDERERS.map((model) => (
            <li
              key={model.id}
              className="flex items-center gap-3 rounded-[12px] border border-[var(--x-line)] bg-[var(--x-raise)] px-4 py-3.5 transition-colors duration-300 hover:border-[var(--x-line-soft)] hover:bg-[var(--x-raise-strong)] motion-reduce:transition-none"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--x-raise-strong)]">
                {model.Logo ? (
                  <model.Logo size={24} className="text-[var(--x-ink)]" />
                ) : (
                  <span className="font-mono text-[12px] uppercase text-[var(--x-ink-45)]">
                    {model.name.slice(0, 2)}
                  </span>
                )}
              </span>
              <span className="truncate text-[13.5px] font-medium tracking-[-0.01em] text-[var(--x-ink)]">
                {model.name}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
