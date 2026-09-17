import type { CSSProperties } from "react";

/**
 * The design system, rebuilt to orchid.ai and measured off the live page on
 * 26 Aug 2026 at 1440px.
 *
 * ── What changed, and why the variable names did not ──
 *
 * This file used to hold x.ai/SpaceX: a #0a0a0a ground, one grotesk, no accent.
 * The page it describes is now built to a different reference and the palette
 * is inverted — paper, not near-black — but every token below kept its old
 * name (`--x-ground`, `--x-raise`, `--x-line`, `--x-ink-45`). That is
 * deliberate: twenty components address these by name, and repointing the
 * values flips the whole page in one place. A rename would have been a
 * twenty-file diff with the same result and twenty chances to miss one.
 *
 * The one thing to know when reading a component: `--x-ground` is now the
 * *lightest* surface and `--x-ink` the darkest. Anything that hardcoded
 * `text-white` or `bg-black/45` had to be handled by hand, and was.
 *
 * ── The reference's three signatures ──
 *
 * 1. **One family, one weight.** Everything is Geist at 500 — display,
 *    section, card, button. There is no serif and no bold. Emphasis is size,
 *    never weight and never family. The Newsreader display serif this page
 *    carried for a day is gone; it was orchid.ai's device and it does not
 *    survive a move to gumloop's system, which is the reference now.
 *
 * 2. **Tracking is -0.025em at every size.** 48px display, 36px section, 18px
 *    card, 14px link — all of them. Measured across their page: -1.2px on 48,
 *    -0.9px on 36, -0.45px on 18. One decision applied four times rather than
 *    four decisions, and it is most of why their page reads as one object.
 *
 * 3. **One ink, an alpha ladder, no second grey.** Body copy is ink/65, rules
 *    are ink/10 at 0.5px, disabled marks are ink/30. There is no grey palette
 *    on that page at all, and no accent hue outside a status dot.
 *
 * ── Where this departs from the reference, deliberately ──
 *
 * orchid.ai's ink is #08152e — a very dark navy that reads as black and
 * behaves as blue, and its paper is #fcfcfd, a hair to the cold side. That
 * blue cast is most of why its greys never look like greys.
 *
 * This page does not take it. The ink is #000 and every tint below it is a
 * neutral alpha of that black, because the product is a terminal and a
 * navy-tinted terminal reads as a theme rather than as a machine. The whole
 * ramp is hue-free: ground, surfaces, rules, scrims and card grounds. What is
 * kept is the *structure* of the reference's colour — one ink, an alpha
 * ladder, no second grey — which is the part that was doing the work.
 *
 * ── Substitutions ──
 *
 * Geist stands in for their licensed grotesk. It is the same category — a
 * neutral geometric sans at 500 — and the structural argument above is the
 * part that carries, not the drawing of the letters.
 */

/* ── Palette ──────────────────────────────────────────────────────────── */

/**
 * Paper and ink, neutral.
 *
 * The ground is #fcfcfc — not #fff, and the difference is the whole trick. A
 * true white ground has nowhere to put a card, so every surface has to be
 * drawn with a border; a ground one step off white lets #f5f5f5 sit on it as
 * a real surface with no line at all.
 *
 * The ink is pure black and everything under it is an alpha of pure black.
 * Two consequences worth knowing before changing a value here:
 *
 *   - There is no second neutral. Do not add `#6b7280`-style greys; take a
 *     step off the ladder. A page with an alpha ramp *and* a grey palette has
 *     two blacks in it and it always shows.
 *   - The contrast floor still holds. ink/65 composites to #585858 on this
 *     ground — 6.8:1 — and ink/55, the navigation tint, lands at 4.6:1. Those
 *     are the two that carry text; ink/30 is decoration and is not held to it.
 */
export const X_TOKENS = {
  /** Paper. The page's only ground; no section overrides it. */
  "--x-ground": "#ffffff",
  /** A surface that sits on paper without a border. */
  "--x-raise": "#f2f2f2",
  /** Chip, hover, pressed. */
  "--x-raise-strong": "#ebebeb",
  /** The rule. Drawn at 0.5px everywhere — see X_RULE. */
  "--x-line": "rgba(0,0,0,0.10)",
  "--x-line-soft": "rgba(0,0,0,0.18)",

  "--x-ink": "#000000",
  /** Card titles, secondary headings, the strong half of a caption. */
  "--x-ink-80": "rgba(0,0,0,0.80)",
  /** Navigation at rest, and any link that comes to full ink on hover. */
  "--x-ink-50": "rgba(0,0,0,0.55)",
  /**
   * Running copy. The reference sets body at ink/65 and it is not a muted
   * grey — 65% black over this ground composites to #585858, ≈6.8:1, past AA
   * for body text with room, which is why the page can afford to have no
   * darker tier for paragraphs at all.
   */
  "--x-ink-45": "rgba(0,0,0,0.65)",
  /** Marks that are present but not information: ticks, rules inside a rule. */
  "--x-ink-30": "rgba(0,0,0,0.30)",

  /**
   * The ground inside a media card, and the black every scrim is mixed from.
   *
   * #0a0a0a rather than #000: the assets in these frames are dark scenes, and
   * a card floor at true black crushes their own shadows into it — the image
   * loses its bottom end and reads as a cutout. One step up gives the picture
   * something to sit on. This is the only place a black on this page is not
   * the ink.
   */
  "--x-well": "#0a0a0a",

  /**
   * The one hue on the page, and only ever as a state. orchid.ai spends its
   * single accent on a 6px "All systems operational" dot in the footer and
   * nowhere else; this is that dot.
   */
  "--x-live": "#00bb7f",

  /* The app-wide keyboard focus ring is `outline: 2px solid var(--foreground)`.
     This landing pins a paper ground regardless of the app's light/dark theme,
     so --foreground must be pinned too or the ring resolves to near-white
     under a dark OS theme and disappears against the page. */
  "--foreground": "#000000",

  "--x-sans": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--x-mono":
    "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  colorScheme: "light",
} as CSSProperties;

/* ── Type ─────────────────────────────────────────────────────────────── */

/**
 * The display line. 48 / 500 / 48 / -0.025em.
 *
 * gumloop.com's H1, measured: `font-size: 48px`, `font-weight: 500`,
 * `line-height: 48px` — exactly equal to the size — and `letter-spacing:
 * -1.2px`, which is -0.025em. Leading equal to the size is what makes a
 * two-line headline read as one block rather than as two lines, and it is why
 * their fold has presence at a weight of only 500.
 */
export const X_DISPLAY =
  "text-[32px] font-medium leading-[1.05] tracking-[-0.025em] sm:text-[38px] lg:text-[42px]";

/**
 * The section heading. 36 / 500 / 45 / -0.025em.
 *
 * Their H2 and H3 are the same object, measured at 36/500/45px/-0.9px. The
 * tracking is the page's one signature: -0.025em at *every* size, from the
 * 48px display down to a 14px card link. That is not four decisions, it is one
 * applied consistently, and it is most of why their page reads as a single
 * object rather than a stack of sections.
 */
export const X_SECTION =
  "text-[24px] font-medium leading-[1.2] tracking-[-0.025em] sm:text-[26px] lg:text-[28px]";

/**
 * A large numeral. 500, leading 1, -0.025em, tabular.
 *
 * Same weight and tracking as everything else — the size is the only thing
 * carrying the emphasis, which is the rule the whole page now follows.
 */
export const X_NUMERAL =
  "font-medium leading-[1] tracking-[-0.025em] tabular-nums";

/**
 * A card's title. Grotesk 500 at 18/26 — *not* serif.
 *
 * The serif is rationed to display, section and numeral. Once it appears at
 * card level too, the page has no quiet tier left and every heading is
 * shouting in the same voice.
 */
export const X_CARD_TITLE =
  "text-[18px] leading-[28px] font-medium tracking-[-0.025em]";

/** The tier below that, inside a 3–4-up grid. */
export const X_CARD_TITLE_SM =
  "text-[17px] leading-[25px] font-medium tracking-[-0.025em]";

/** The line under a *display* headline. 17 → 18, leading 1.5, ink/65. */
export const X_LEDE =
  "text-[16px] leading-[1.5] font-normal text-[var(--x-ink-45)] sm:text-[17px]";

/**
 * The line under a *section* heading. 16/1.5 at ink/65.
 *
 * The reference caps this at `max-width: 470px` — about 62 characters — and
 * holds it there at every width. Sections below pair this token with a
 * `max-w-[470px]` rather than a `ch` measure, because the serif and grotesk
 * disagree about what a `ch` is.
 */
export const X_INTRO =
  "text-[16px] leading-[1.5] font-normal text-[var(--x-ink-45)]";

/** Body copy inside a card, below its title. */
export const X_BODY_SM = "text-[15px] leading-[23px] font-normal";

/** Navigation, buttons, card links. Grotesk 500 at 14, tracking normal. */
export const X_SMALL =
  "text-[14px] leading-[20px] font-medium tracking-[-0.025em]";

/** Captions under a figure or a stat. */
export const X_CAPTION =
  "text-[14px] leading-[21px] font-normal text-[var(--x-ink-45)]";

/**
 * Eyebrows and machine labels. Mono, 12, uppercase.
 *
 * Kept from the previous system, and it is not a carry-over by accident: the
 * reference's own brand page assigns JetBrains Mono to "code and labels", so
 * a mono eyebrow is in the reference's grammar even though its marketing
 * sections rarely reach for one.
 */
export const X_LABEL =
  "font-mono text-[12px] leading-[16px] font-normal uppercase tracking-[0.06em] text-[var(--x-ink-45)]";

/* ── Rules ────────────────────────────────────────────────────────────── */

/**
 * 0.5px, ink/10.
 *
 * Half a pixel, not one. The reference draws every divider on the page at
 * `border-b-[0.5px] border-ink/10` and on a 2× display that is a genuinely
 * finer line than 1px at a lighter alpha — it stays a hairline instead of
 * becoming a grey band. On a 1× display it rounds up and looks like what a 1px
 * rule was always trying to be.
 */
export const X_RULE = "border-[var(--x-line)] [border-width:0.5px]";
/** The same rule as a single bottom edge — the reference's list row. */
export const X_RULE_B =
  "border-b-[0.5px] border-b-[var(--x-line)] border-solid";

/* ── Controls ─────────────────────────────────────────────────────────── */

/**
 * Small pills, 40 tall, 14/500 inside, full radius.
 *
 * The reference ships these at *30px* — `padding: 8px 10px`, 94×30 measured —
 * and the smallness is load-bearing: a page whose hierarchy is carried by a
 * 64px serif line cannot also have a 44px button in the same view without the
 * button winning. 40 is the compromise this page ships: visibly a quiet
 * control rather than a hero element, and still twice the WCAG 2.2 target-size
 * minimum of 24px, where 30 would have left nothing for a thumb.
 *
 * `whitespace-nowrap` is not cosmetic. A fixed-height pill whose label wraps
 * does not grow — the second line renders outside the rounded box. At 420px
 * both bar controls did exactly that ("Log in" over two lines, "Start" above
 * "building"), which is the kind of break that only ever shows up on a phone.
 */
export const X_BTN =
  "inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-4.5 text-[14px] font-medium leading-5 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--x-ink)] motion-reduce:transition-none";
export const X_BTN_FILLED = `${X_BTN} bg-[var(--x-ink)] text-[var(--x-ground)] hover:bg-[#262626]`;
export const X_BTN_GHOST = `${X_BTN} border-[0.5px] border-[var(--x-line-soft)] text-[var(--x-ink)] hover:bg-[var(--x-raise)]`;
/** The same pill on top of a photograph, where the ground is unknown. */
export const X_BTN_ON_MEDIA = `${X_BTN} bg-white text-black hover:bg-white/90`;

/* ── Layout ───────────────────────────────────────────────────────────── */

/**
 * 1440 wide with 40px gutters.
 *
 * This was orchid.ai's measure — a 1320 cap behind 120px gutters, which put
 * the content at 1200 and left a sixth of a 1440 screen empty on each side.
 * That is right for a page which is mostly one column of prose and wrong for
 * one carrying three full-width product windows: the windows were the thing a
 * reader came to look at and they were being rendered at 83% of the width
 * available to them.
 *
 * gumloop.com measures `max-width: 1440px` with `padding-left: 40px`, and it
 * is the same number their product stages are authored at, so a stage fills
 * its container exactly. Ours now does too.
 */
export const X_CONTAINER = "mx-auto w-full max-w-[1440px] px-6 md:px-10";

/**
 * 128 / 176 / 224.
 *
 * Three times the vertical air of the system this replaced, and it is the
 * single change that does most of the work. The reference has one ground
 * colour for the entire page and never draws a section boundary — the only
 * thing separating one argument from the next is this much empty paper.
 */
export const X_SECTION_PAD = "py-16 md:py-20 min-[1280px]:py-24";

/** Half of it, for a section that continues the one above rather than opening. */
export const X_SECTION_PAD_TIGHT = "py-10 md:py-12 min-[1280px]:py-16";

/**
 * The radius on a media card. 24 on a phone, 28 above it.
 *
 * The reference computes this as `rounded-[16cqw]` against the card's own
 * container so a 400px phone mockup and a 1200px photograph carry a
 * proportionally identical corner. Container queries would work here too, but
 * every card on this page is one of two widths, so two literals say the same
 * thing and survive a Tailwind scan.
 */
export const X_MEDIA_RADIUS = "rounded-[24px] md:rounded-[28px]";
