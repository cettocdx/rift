"use client";

import { ArrowUp } from "lucide-react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef, useState } from "react";

import { CONTAINER, MICRO, STAGGER, rise } from "./landing-design-system";
import { HeroAtmosphere } from "./HeroAtmosphere";
import { HeroMark } from "./HeroMark";
import { useLandingScrollContainer } from "./LandingShell";
import { RiftMiniApp, type MiniAppHandle } from "./RiftMiniApp";

/**
 * The hero, quiet.
 *
 * Four compositions were built and compared side by side on a live page: big
 * type on a photographed steel ground, a 7/5 split with a signature mark, a
 * centred console on an empty screen, and this one. This is Cursor's position,
 * and it is the riskiest of the four — cursor.com sets its h1 at 26px and
 * weight 400 and lets the product carry the page, which only works if the
 * product is worth looking at.
 *
 * It works here because the frame below is not a screenshot. It is the
 * application's own chrome, every surface operates, and a visitor can type a
 * task into it and watch an agent take it. A page with a working product on it
 * does not need a headline that shouts; shouting is what a page does when it
 * has nothing to show.
 *
 * So the type states the claim once, plainly, at reading size, and gets out of
 * the way. The input is the first control on the page, and the frame it drives
 * starts inside the fold.
 *
 * The ground is a light, not a photograph.
 *
 * Measured on a 1512px viewport, the quiet type block leaves 819px of empty
 * ground to its right for the height of the fold — a dead rectangle in the
 * most valuable part of the page, which reads as unfinished rather than as
 * confident. Every reference fills it the same way, with the only bright thing
 * above their fold. See HeroAtmosphere for what replaced the steel plate that
 * used to sit here and why it had to go.
 */
export function MergedHero() {
  const reduceMotion = useReducedMotion() ?? false;
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const miniAppRef = useRef<MiniAppHandle>(null);
  const [draft, setDraft] = useState("");

  const scrollContainer = useLandingScrollContainer();
  const { scrollYProgress } = useScroll({
    container: scrollContainer ?? undefined,
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const plateY = useTransform(scrollYProgress, [0, 1], ["0%", "16%"]);
  const plateOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.1]);

  const at = (index: number) => rise(index * STAGGER, reduceMotion);

  const ask = (text: string) => {
    miniAppRef.current?.run(text);
    frameRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
  };

  return (
    <section
      ref={sectionRef}
      // pt-32 below `sm`: the nav grows a second row on a phone for the
      // section links, and the old 96px put the headline under it.
      className="relative isolate overflow-hidden pt-32 sm:pt-28"
    >
      <motion.div
        aria-hidden
        style={reduceMotion ? undefined : { y: plateY, opacity: plateOpacity }}
        className="absolute inset-x-0 top-0 -z-10 h-[82vh]"
      >
        <HeroAtmosphere className="absolute inset-0" />
      </motion.div>

      <div className={CONTAINER}>
        {/*
         * vercel.com's fold, arranged: the sentence and its actions on the
         * left, one lit object in the middle, three short lines on the right,
         * and nothing else. Measured on their page — headline at x=56, the
         * graphic centred at x=742, the three lines starting at x=1080 — and
         * the reason it works is that the middle column is the only bright
         * thing in the fold, so the eye lands there and then reads outward.
         *
         * The right column is ours to fill honestly. Vercel's says what the
         * product is for in three fragments; these are the three surfaces this
         * product actually has, which is the same job.
         */}
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.5fr)]">
          <div>
            {/* Reading size, not display size. The sentence has to survive being
            read rather than scanned, so it says what the product is in one
            clause and what it does in the second.

            Restored after a pass that cut it to six words at 52px to sit in the
            band the peer group sets — tempo.new 52/500, mintlify.com 50/400,
            databuddy.cc 60/600. The measurement was right and the change was
            still wrong for this page: the frame below is the argument, and a
            headline that competes with it takes the fold back from the product.
            The quiet variant was chosen deliberately and it stays. */}
            <motion.h1
              {...at(0)}
              className="max-w-[26ch] text-[26px] font-normal leading-[1.25] tracking-[-0.0125em] text-foreground sm:text-[30px]"
            >
              RIFT is the workstation your agents run on — plan, write, execute
              and verify, inside a real sandbox.
            </motion.h1>

            <motion.form
              {...at(1)}
              onSubmit={(event) => {
                event.preventDefault();
                const text = draft.trim();
                if (text) ask(text);
              }}
              className="mt-6 max-w-[480px]"
            >
              <div className="flex items-center gap-2 rounded-full border border-border-strong bg-[var(--surface)] py-2 pe-2 ps-5 transition-colors focus-within:border-foreground/30 motion-reduce:transition-none">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask RIFT to build, fix or investigate something"
                  aria-label="Ask RIFT"
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-[14px] text-foreground outline-none placeholder:text-foreground/35"
                />
                <button
                  type="submit"
                  aria-label="Run it"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform duration-100 active:scale-95 focus-visible:outline-none motion-reduce:transition-none"
                >
                  <ArrowUp aria-hidden className="size-4" strokeWidth={2} />
                </button>
              </div>
              <p
                className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 ${MICRO}`}
              >
                {/* The separator and the underline are both load-bearing. Without
                them the line rendered as one uppercase string — "NO ACCOUNT
                NEEDED OR START BUILDING" — and the only link in the hero was
                indistinguishable from the sentence it sat in. */}
                <span>Runs a real example · no account needed</span>
                <span aria-hidden className="text-foreground/25">
                  ·
                </span>
                <a
                  href="/login"
                  className="text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground motion-reduce:transition-none"
                >
                  or start building
                </a>
              </p>
            </motion.form>
          </div>

          {/* The object. Hidden below `lg`: on a phone the fold belongs to the
            sentence and the input, and a 420px mark above them would push both
            off the screen. */}
          <motion.div {...at(2)} className="hidden justify-center lg:flex">
            <HeroMark className="aspect-square w-full max-w-[420px]" />
          </motion.div>

          {/* Three lines, no punctuation, no links — vercel.com's exact
            treatment for this column. */}
          <motion.ul
            {...at(3)}
            className="hidden flex-col gap-3 text-[15px] leading-[1.4] text-[var(--cursor-text-secondary)] lg:flex"
          >
            <li>Plans, writes and executes</li>
            <li>Inside a real sandbox</li>
            <li>Verified before it claims</li>
          </motion.ul>
        </div>

        {/* The product, operable, and inside the fold.
            The entrance now belongs to ProductFrame, which materialises every
            frame on the page the same way — blur and scale together, so the
            surface arrives rather than a rectangle appearing. Wrapping it in a
            second motion element here ran two entrances on one object. */}
        <div ref={frameRef} className="mt-9">
          <RiftMiniApp ref={miniAppRef} />
        </div>
      </div>
    </section>
  );
}
