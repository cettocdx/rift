"use client";

import { Reveal } from "./reveal";
import type { ReactNode } from "react";

import { XFeatureList } from "./x-pieces";
import { XStage } from "./XStage";
import {
  X_CAPTION,
  X_CONTAINER,
  X_INTRO,
  X_LABEL,
  X_SECTION,
  X_SECTION_PAD,
  X_SMALL,
} from "./x-system";

/**
 * A product section: a claim, then the product making it.
 *
 * ── Rebuilt to the reference's feature block ──
 *
 * orchid.ai repeats one shape five times: a short serif heading, a line under
 * it, three ruled rows, a small button — and a media card on the other side of
 * the grid, alternating left and right down the page. Three things about it
 * are worth naming because each replaces something that was here before.
 *
 * 1. **The rows are ruled, not boxed.** The previous version put the bullets in
 *    a bordered grid whose 1px gaps were painted by the container background.
 *    That is a good technique on a near-black page, where a gap reads as a
 *    seam; on paper it becomes a visible grey lattice, and the reader sees the
 *    lattice. `XFeatureList` draws the reference's `py-3` row with a 0.5px
 *    bottom rule at ink/10 and nothing else.
 *
 * 2. **The sides alternate.** `flip` swaps the column order. It is a small
 *    thing that does more than it looks like it should — five sections with
 *    the text always on the left read as a list, and the same five alternating
 *    read as a tour.
 *
 * 3. **The product is still full width, and on a stage.** This is where the
 *    page departs from the reference on purpose. Its media card is a
 *    photograph and fits in half a grid; ours is the running product with a
 *    sidebar, a terminal and a diff in it, and half a grid is not enough room
 *    to read one. So the header alternates and the surface below it spans, in
 *    an `XStage` — see that file for why the app is scaled rather than
 *    reflowed, which is the difference between showing the product and showing
 *    a broken narrow version of it.
 *
 * ── The `note`, and why it is not optional in practice ──
 *
 * Whatever is in the frame, the reader is told what it is. That started as a
 * fix for a specific failure: the mini-apps were rendered `variant="bare"`,
 * which drops ProductFrame's own mat *and its caption with it*, so the first
 * version of this section showed a scripted replay under a heading claiming it
 * was the running product, with the disclosure silently removed by a layout
 * choice.
 *
 * The frames are mostly real screenshots now and the rule did not relax — it
 * changed what it has to disclose. A still needs a date, because a photograph
 * of software is a claim about a moment; and it needs to say what state the
 * product was in, because a reader looking at four zeroed counters with no
 * caption concludes the product found nothing.
 */
export function XSurface({
  id,
  eyebrow,
  title,
  lede,
  bullets,
  action,
  note,
  live,
  stageTitle,
  stageHeight,
  flip = false,
  after,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede: string;
  bullets: readonly string[];
  action?: { label: string; href: string };
  /** What the reader is actually looking at. Say it plainly. */
  note?: string;
  /**
   * The affordance line above the frame — "Type a task", "Run the pass".
   *
   * These surfaces are the running product and a visitor can use them without
   * signing in, which is the strongest thing on the page and was, until this
   * prop, invisible. RiftMiniApp carries its own caption saying exactly that
   * ("Type into it, or pick a surface") and every instance here is rendered
   * `variant="bare"`, which drops the mat *and the caption with it*. So the
   * page was serving three live surfaces while looking like it served three
   * screenshots.
   *
   * The dot is the page's only hue, the same emerald as the footer's status
   * line, and it is spent here for the same reason: it is a state, not
   * decoration.
   */
  live?: string;
  /** The window's own title, in the stage's title bar. */
  stageTitle: string;
  /** The stage's fixed height, in authored (1440-wide) pixels. */
  stageHeight: number;
  /** Put the ruled rows on the left and the copy on the right. */
  flip?: boolean;
  /**
   * Anything that belongs to this section but not inside the product frame —
   * the vendor ring, the render gallery.
   *
   * These used to be passed as `children` with an `mt-24`, which put them
   * *inside* the bordered frame along with the running product. That was
   * survivable when the frame was a 1px hairline over a 2%-raise fill and is
   * not now: the frame contains a photograph of the app, and a logo ring
   * sharing its corner reads as part of the screenshot.
   */
  after?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`${X_SECTION_PAD} scroll-mt-24`}>
      <div className={X_CONTAINER}>
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal className={flip ? "lg:order-2" : undefined}>
            <p className={X_LABEL}>{eyebrow}</p>
            {/* max-w in px, not ch: the serif and the grotesk disagree about
                the width of a character by enough that one cap cannot set the
                measure for both. These are the reference's own two numbers. */}
            <h2
              className={`${X_SECTION} mt-5 max-w-[15ch] text-balance text-[var(--x-ink)]`}
            >
              {title}
            </h2>
            <p className={`${X_INTRO} mt-5 max-w-[470px]`}>{lede}</p>
            {action ? (
              <a
                href={action.href}
                className={`${X_SMALL} mt-8 inline-flex items-center gap-1.5 text-[var(--x-ink)] underline decoration-[var(--x-line-soft)] underline-offset-[6px] transition-colors hover:decoration-[var(--x-ink)] motion-reduce:transition-none`}
              >
                {action.label}
                <span aria-hidden>→</span>
              </a>
            ) : null}
          </Reveal>

          <Reveal step={1} className={flip ? "lg:order-1" : undefined}>
            <XFeatureList items={bullets} />
          </Reveal>
        </div>

        {/*
         * The product itself, in a frame that gets out of its way.
         *
         * A 0.5px hairline and the media radius — no fill of its own. The
         * surfaces inside paint their own ground, and a card colour underneath
         * one only ever shows as a rim of the wrong shade around it.
         */}
        <Reveal step={2}>
          {/* The affordance line, no dot.
              It carried a pulsing emerald dot that repeated on all three
              surfaces and read as decoration rather than state — the label
              already says the frame is live, so the dot only added noise. */}
          {live ? (
            <p className={`${X_LABEL} mt-10 mb-3 hidden sm:block`}>{live}</p>
          ) : null}
          <div className={live ? "" : "mt-10"}>
            <XStage title={stageTitle} height={stageHeight}>
              {children}
            </XStage>
          </div>
        </Reveal>
        {note ? <p className={`${X_CAPTION} mt-5 max-w-[720px]`}>{note}</p> : null}

        {after ? (
          <Reveal step={2} className="mt-14 md:mt-16">
            {after}
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}
