import Image from "next/image";

import { F1Reveal } from "./F1Reveal";
import { PRODUCT_SURFACES } from "./f1-content";
import { F1_BODY_CLASS, F1_CONTAINER_CLASS, F1_LABEL_CLASS } from "./f1-design";

const SURFACE_LAYOUT: Record<(typeof PRODUCT_SURFACES)[number]["id"], string> =
  {
    build: "xl:col-span-6",
    studio: "xl:col-span-3",
    hack: "xl:col-span-3",
  };

const SURFACE_IMAGE_SIZES: Record<
  (typeof PRODUCT_SURFACES)[number]["id"],
  string
> = {
  build:
    "(max-width: 639px) calc(100vw - 40px), (max-width: 767px) calc(100vw - 64px), (max-width: 1023px) calc((100vw - 80px) / 2), (max-width: 1279px) calc((min(100vw, 1240px) - 112px) / 3), 572px",
  studio:
    "(max-width: 639px) calc(100vw - 40px), (max-width: 767px) calc(100vw - 64px), (max-width: 1023px) calc((100vw - 80px) / 2), (max-width: 1279px) calc((min(100vw, 1240px) - 112px) / 3), 278px",
  hack: "(max-width: 639px) calc(100vw - 40px), (max-width: 767px) calc(100vw - 64px), (max-width: 1023px) calc(100vw - 64px), (max-width: 1279px) calc((min(100vw, 1240px) - 112px) / 3), 278px",
};

export function ProductProof() {
  return (
    <section
      id="product"
      aria-labelledby="product-proof-title"
      className="scroll-mt-20 border-y border-border py-14 sm:py-16"
    >
      <div className={F1_CONTAINER_CLASS}>
        <F1Reveal>
          <div className="max-w-[760px]">
            <h2
              id="product-proof-title"
              className="max-w-[18ch] text-[24px] font-medium leading-[1.1] tracking-[-0.02em] sm:text-[28px]"
            >
              One workstation, three real surfaces.
            </h2>
            <p className={`${F1_BODY_CLASS} mt-4 max-w-[52ch]`}>
              The work stays visible from the first instruction to the output
              that leaves the system.
            </p>
          </div>
        </F1Reveal>

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-12">
          {PRODUCT_SURFACES.map((surface, index) => (
            <F1Reveal
              key={surface.id}
              delay={index * 0.06}
              className={`${SURFACE_LAYOUT[surface.id]} md:last:col-span-2 lg:last:col-span-1 xl:last:col-span-3`}
            >
              <article className="flex h-full flex-col overflow-hidden rounded-[14px] border border-border bg-[var(--surface)]">
                <div className="aspect-[16/10] overflow-hidden border-b border-border">
                  <Image
                    src={surface.imageSrc}
                    alt={surface.imageAlt}
                    width={3840}
                    height={2160}
                    sizes={SURFACE_IMAGE_SIZES[surface.id]}
                    className="size-full object-cover"
                  />
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className={F1_LABEL_CLASS}>{surface.label}</p>
                  <h3 className="mt-3 text-[18px] font-medium tracking-[-0.015em]">
                    {surface.outcome}
                  </h3>
                  <p className={`${F1_BODY_CLASS} mt-2`}>{surface.detail}</p>
                </div>
              </article>
            </F1Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
