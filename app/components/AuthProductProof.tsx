import Image from "next/image";

import { XShatterMark } from "@/app/components/landing-x/XShatterMark";

const APPLICATION_PREVIEW = "/landing/product/application-studio-4k.webp";

type AuthProductProofVariant = "application" | "login-artwork";

/**
 * What sits beside the form.
 *
 * ── Why the photograph is gone ──
 *
 * The sign-in screen used to put a 4K monochrome portrait here, captioned
 * "Create with no limitations". It was a good image and it was from a
 * different product: nothing on it is RIFT, and a visitor arriving from the
 * landing page met a wordmark, a palette and a subject they had not seen five
 * seconds earlier. The landing was rebuilt to gumloop's system — white ground,
 * pure black ink, one grotesk — and this panel is the last screen before the
 * workspace, so it is the one place the brand can least afford to change.
 *
 * What replaces it is the landing's own closing frame, turned on its side:
 * `XShatterMark` rasterises the real mark into a grid and resolves it, left to
 * right, in a single bearing. A visitor who scrolled to the bottom of the
 * landing has already seen this exact animation; meeting it again behind the
 * password field is the point.
 *
 * The plate is `#000000` rather than the near-black most dark UIs use, for the
 * same reason the product surfaces are: it is what the application runs, and
 * the mark's white cells read at full contrast against it.
 *
 * The `application` variant is untouched. It is the framed layout's visual — a
 * still of the finished workspace — and that is the right argument on a screen
 * that is selling the product rather than closing the loop on the landing.
 */
export function AuthProductProof({
  variant = "application",
}: {
  variant?: AuthProductProofVariant;
}) {
  if (variant === "login-artwork") {
    return (
      <aside
        data-auth-visual="login-artwork"
        aria-label="What RIFT does"
        className="relative hidden min-h-0 overflow-hidden border-l-[0.5px] border-l-[var(--pa-line)] bg-black lg:block"
      >
        {/*
         * The mark, resolving.
         *
         * The box stops at 38% from the bottom so it never reaches the copy,
         * and carries its own padding because the mark fits to whichever
         * dimension is tighter: with none, a short viewport renders it edge to
         * edge and the plate reads as a logo with text under it rather than as
         * a frame.
         */}
        <div className="absolute inset-0 bottom-[38%] px-16 py-14 xl:px-24">
          <XShatterMark className="size-full" />
        </div>

        {/*
         * The scrim. Opaque under the copy, gone by 62% of the way up — the
         * closing band's gradient, rotated, so the mark's lowest cells fade
         * out rather than being cut off by a hard edge.
         */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(to_top,#000000_0%,rgba(0,0,0,0.92)_26%,rgba(0,0,0,0.35)_44%,transparent_62%)]"
        />

        <div className="absolute inset-x-0 bottom-0 px-12 pb-14 xl:px-16">
          <h2 className="max-w-[20ch] text-[24px] font-medium leading-[1.2] tracking-[-0.025em] text-white xl:text-[26px]">
            Give it the work.{" "}
            <span className="text-white/45">Get it finished.</span>
          </h2>
          <p className="mt-4 max-w-[42ch] text-[14px] leading-[21px] text-white/55">
            A frontier agent on a real machine, with a filesystem, a package
            manager and a terminal. It does not say done until it has run what
            it wrote.
          </p>

          {/* Three facts, ruled like every group of facts on the landing. */}
          <ul className="mt-10 grid max-w-[420px] grid-cols-3 gap-x-6 border-t-[0.5px] border-t-white/12 pt-5">
            {[
              ["Sandbox", "One per run"],
              ["Evidence", "Kept with the run"],
              ["Cost", "On the receipt"],
            ].map(([label, value]) => (
              <li key={label}>
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-white/40">
                  {label}
                </span>
                <span className="mt-1.5 block text-[13px] leading-[18px] text-white/75">
                  {value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    );
  }

  return (
    <aside
      data-auth-visual="application"
      aria-label="Creative studio application preview"
      className="relative m-4 ml-0 hidden min-h-0 overflow-hidden rounded-[8px] border border-[var(--pa-line)] bg-[var(--pa-ground)] lg:block"
    >
      <Image
        src={APPLICATION_PREVIEW}
        alt="A finished creative studio application with projects, weekly milestones, reviews, and a product preview"
        fill
        priority
        sizes="(max-width: 767px) 0px, (max-width: 1279px) 58vw, 62vw"
        className="object-cover object-[55%_center] xl:object-[64%_center]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/[0.06]"
      />
    </aside>
  );
}
