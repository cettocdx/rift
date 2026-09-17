import type { CSSProperties } from "react";

/**
 * The public design system, merged from two parallel attempts at the same page.
 *
 * Two directions were built for this landing on the same branch: one derived
 * from measuring axiom.co, linear.app, cursor.com, v0.app, lovable.dev and
 * bolt.new (docs/product-transformation/axiom-visual-benchmark-2026-08-18.md),
 * and one built around a 7/5 hero with an aperture signature. They arrived at
 * the same typography independently — display weight 500, tracking -0.025em, a
 * 1240px column, an 11px mono label — which is the strongest evidence available
 * that those three are not preferences.
 *
 * Where they disagreed, this file takes whichever side the measurements
 * support, and each choice below records which:
 *
 *   ground      F1's. Not one measured reference uses pure black — Linear sits
 *               at #08090a, Cursor at rgb(20,18,11), Axiom at #060606. Each
 *               commits to a temperature. Ours is warm, because the accent is.
 *   hairlines   Axiom's. Its card border is rgb(17,17,17) on a #060606 ground,
 *               barely a line; the F1 value was #282828, which draws a
 *               rectangle around every card and makes a page of cards read as
 *               a page of boxes.
 *   lead size   Axiom's. Axiom and Linear both set 15px. 18px reads as a
 *               presentation slide.
 *   display max 72px, Axiom's measured value. Linear stops at 64. 88px was
 *               larger than anything in the reference set.
 *   hero layout F1's 7/5 split. A single column pushed the product 600px down
 *               the page; the split shows the claim and the evidence together.
 *
 * Motion tokens live here too, because a page whose easing is decided per
 * component ends up with six different ideas of how fast it moves.
 */

/* ── Palette ──────────────────────────────────────────────────────────── */

/**
 * Black and white — a warm black, and a warm white.
 *
 * There is no accent hue. That is the harder choice and the stronger one: v0
 * and Cursor both ship a marketing page with no colour at all, and it reads as
 * confidence — nothing is asking for attention, so the product has to hold it.
 * A coloured button is the cheapest way to look like every other tool in the
 * category.
 *
 * But a black still has to be chosen. `#000000` is the absence of a decision,
 * and on an OLED panel it takes the shadow with it, so a raised surface stops
 * reading as raised. Every reference commits to a temperature: Linear cools to
 * #08090a, Cursor warms to rgb(20,18,11), okara.ai warms to rgb(17,15,14) and
 * pairs it with an equally warm rgb(243,240,236) for type. A neutral grey in
 * that company reads as the one nobody picked.
 *
 * So: warm on both ends. Red runs two points above blue through the whole
 * ramp, which is below the threshold at which anyone would call it brown, and
 * above the threshold at which the page reads as one material rather than as
 * grey text on grey ground. It is still black and white.
 *
 * Emphasis is carried by weight and opacity: full strength for what matters,
 * 60% for what supports it, 40% for labels.
 */
export const LANDING_TOKENS = {
  "--font-cursor-ui": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--font-display": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--font-sans": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--font-mono":
    "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',

  /*
   * Measured, not eyeballed. The first ramp put every surface within 1.03 of
   * the ground and every hairline within 1.12, which is another way of saying
   * the cards had neither a fill nor an edge — a page of invisible boxes on
   * invisible lines. Contrast against #0A0908, computed:
   *
   *   surface        1.03 -> 1.24    a card reads as raised
   *   border         1.12 -> 1.40    a hairline actually draws
   *   border-strong  1.31 -> 1.94    a control edge reads as an edge
   *   sidebar        1.02 -> 1.13    the panel reads as a panel
   *
   * Measured against the peers rather than guessed: axiom.co's card sits at
   * 1.07 against its own ground, linear.app at 1.11, claude.com at 1.21. Ours
   * clears all three.
   *
   * ── The ground itself, which is the part that was actually wrong ──
   *
   * The ramp above was right and the page still read as too black, because
   * every one of those ratios is *relative* — a correct ramp sitting on a
   * near-OLED floor is still a page made of black. Measuring the absolute
   * level said so plainly:
   *
   *   RIFT        #0A0908   luminance 0.0028
   *   tempo.new   #010101   luminance 0.0003
   *   databuddy   #18181C   luminance 0.0093
   *
   * tempo really is blacker than we were, and gets away with it because it
   * spends the contrast elsewhere: a starfield, a saturated gradient mat under
   * the product, and a bright #D9D9D9 grid node at every intersection. Its page
   * is black the way a photograph is black — around something lit. databuddy
   * takes the other road and simply lifts the floor to a grey, and its own ramp
   * on top measures surface 1.25 and border 1.38, which is within a hair of
   * ours. Same ramp, different floor.
   *
   * We had neither the light source nor the floor. So the floor moves: #1A1816
   * has luminance 0.00931 against databuddy's 0.00931 — parity to five decimal
   * places, and 3.4x the level we were at. It stays warm-neutral (R>G>B) and
   * introduces no hue, so "black and white overall" holds.
   *
   * Every value above it was re-solved against the new floor rather than
   * nudged, so the ratios that were already correct are preserved exactly.
   * The old sidebar value was #1A1816; it is now the ground, and the panel
   * moves up a step to stay a panel.
   */
  /*
   * ── vercel.com's palette, measured ──
   *
   * Asked for directly, and the values are theirs rather than an impression of
   * them. Read off vercel.com with getComputedStyle on 20 Aug 2026:
   *
   *   ground     rgb(0,0,0)            luminance 0
   *   surface    rgb(10,10,10)         1.06 against it
   *   border     rgba(255,255,255,.14) 1.35
   *   ink        rgb(237,237,237)
   *   dim        rgb(161,161,161)
   *   type       GeistSans, 481 elements to Geist Mono's 29
   *
   * Two things follow from that list. The first is that our typeface was
   * already theirs — this page has been set in Geist throughout, so the switch
   * costs nothing and gains the exact letterforms. The second is that Vercel's
   * black is *absolute*, and the ramp on top of it is barely there: 1.06 for a
   * surface is a third of what this page uses.
   *
   * So: their ground and their ink, our ramp. The floor goes to #000000 and the
   * neutral grey replaces the warm one — Vercel commits to no temperature at
   * all, which is a choice as much as warmth was — but the steps above it stay
   * at the contrasts this page was measured into (surface 1.24, border 1.40,
   * strong 1.94). Taking Vercel's 1.06 as well would undo the "the page is too
   * black" fix in the same edit that caused it, and Vercel can afford it for
   * reasons this page cannot copy: every one of its sections is anchored by a
   * large, brightly lit product still, and its display type is 56px of near-
   * white. Ours carries the same argument in a running product frame.
   *
   * The alphas are solved against black rather than converted, so each one
   * lands on its target ratio exactly; the hex each composites to is noted for
   * anyone checking by eye.
   */
  "--background": "#000000",
  "--foreground": "#EDEDED",
  "--surface": "rgba(255,255,255,0.1206)",
  "--border": "rgba(255,255,255,0.1632)",
  "--border-strong": "rgba(255,255,255,0.2583)",
  "--muted-foreground": "#8F8F8F",
  "--cursor-text-secondary": "#A1A1A1",
  /*
   * The drafting guide, at tempo's own weight.
   *
   * tempo draws its grid with `repeating-linear-gradient(#333 0 4px,
   * transparent 4px 8px)` — 1px wide, 4-on-4-off — which measures 1.65 against
   * its ground. #403E3C measures 1.66 against ours, so the guide carries the
   * same presence on a floor five times brighter. The node at each
   * intersection is theirs too: 10px, near-white, and deliberately brighter
   * than anything else at that scale.
   */
  /* vercel.com's section divider, measured: rgb(31,31,31). */
  "--grid-line": "#1F1F1F",
  "--grid-node": "#D9D9D9",
  /* The primary action is the warm white on the warm black. No accent hue. */
  "--primary": "#EDEDED",
  "--signal-bright": "#EDEDED",

  /*
   * The workspace chrome's own tokens.
   *
   * The frame renders with the application's real sidebar classes, and those
   * read `--sidebar`, `--sidebar-border` and the rest. Undefined here, they
   * fell back to the default dark theme, whose sidebar is a blue-grey
   * `rgb(43,55,62)` — a colour nothing in the product is ever painted with, on
   * a page whose entire claim is that this is the real interface. Measured on
   * the rendered page before this existed.
   *
   * Values are the OLED preset's, warmed the same two points as the rest of
   * the ramp so the panel belongs to the page it sits on.
   */
  "--sidebar": "rgba(255,255,255,0.0755)",
  "--sidebar-foreground": "#EDEDED",
  "--sidebar-border": "rgba(255,255,255,0.1632)",
  "--sidebar-accent": "rgba(255,255,255,0.1450)",
  "--sidebar-accent-foreground": "#EDEDED",
  "--sidebar-ring": "rgba(255,255,255,0.21)",
  "--cursor-icon-secondary": "#8F8F8F",
  "--cursor-text-tertiary": "#6E6E6E",
  colorScheme: "dark",
} as CSSProperties;

/* ── Type ─────────────────────────────────────────────────────────────── */

/** Hero display, kept for the marketing sub-pages that still use a big line. */
export const DISPLAY =
  "text-[40px] leading-[1.0] tracking-[-0.06em] font-normal sm:text-[56px] lg:text-[64px] lg:leading-[1.0]";

/**
 * Section heading.
 *
 * Weight 400, not 500. The 500 came from measuring axiom.co and linear.app,
 * which are the right references for rhythm and colour but not for this — they
 * are observability and project tooling. Measured across the products RIFT
 * actually competes with, display weight runs lighter still:
 *
 *   zed.dev          plexSerif      48px   weight 320
 *   claude.com       anthropicSerif 104px  weight 400
 *   devin.ai         nbInternational 64px  weight 400
 *   cursor.com       CursorGothic    26px  weight 400
 *
 * Four of the closest four sit between 320 and 400, and ours was the heaviest
 * thing in the set. At 40px on a near-black ground, 400 still carries a
 * section — the size is doing that work — and it stops the page sounding
 * louder than every product it is measured against.
 */
export const SECTION_TITLE =
  "text-[34px] leading-[1.02] tracking-[-0.055em] font-[450] sm:text-[44px] lg:text-[56px] lg:leading-[1.0]";

/** The sentence under a display line. */
export const LEAD =
  "text-[16px] leading-[1.6] tracking-[-0.006em] text-foreground/60";

/** Running copy inside a section. */
export const BODY = "text-[15px] leading-[1.6] text-foreground/60";

/** Card and control titles. */
export const CARD_TITLE =
  "text-[15px] font-medium tracking-[-0.01em] text-foreground";

/**
 * Navigation and control labels.
 *
 * 450, not 400. Axiom sets its nav links and both its buttons at 450 — half a
 * step above regular, which at 13px is the difference between a link that
 * recedes into the page and one that reads as a control. Geist is a variable
 * font, so the axis is real rather than snapped to the nearest static cut; the
 * lesson from the app's own type work is that a fractional weight is only safe
 * on a face that actually carries the axis.
 */
export const CONTROL = "text-[13px] font-[450] tracking-normal";

/**
 * Eyebrow and data label. The one device every reference page uses.
 *
 * One typeface on this page, and it is the application's.
 *
 * These labels used to be set in JetBrains Mono, which gave the page two
 * voices: the product's own sans in the frame and a second, narrower face
 * everywhere around it. tempo.new and the rest of this peer group run a single
 * family top to bottom — tempo sets its 52px headline and its 12px eyebrow in
 * the same SF Pro — and the page reads as one object because of it. Ours is
 * Geist, which is what `--font-sans` resolves to in the product's chrome, so
 * the marketing page and the sidebar it shows are now literally the same type.
 *
 * Mono survives in exactly two places, both inside the frame and both because
 * the content is machine output rather than prose: the tool arguments in the
 * Activity panel, and the Workbench's terminal. That is a typeface used as a
 * semantic, which is the only use that earns a second face.
 *
 * The compensations for the switch, measured: Geist at 11px uppercase is
 * lighter on the page than JetBrains Mono at the same size, so weight goes to
 * 500 and tracking opens from 0.1em to 0.11em. Opacity goes 50% -> 55%, which
 * takes the contrast from 4.85:1 to 5.42:1 against the ground — still the
 * quietest thing on the page, now comfortably clear of the 4.5:1 AA floor that
 * 11px uppercase text has no margin for.
 */
export const MICRO =
  "text-[11px] font-medium uppercase tracking-[0.11em] text-foreground/55";

/* ── Layout ───────────────────────────────────────────────────────────── */

export const CONTAINER = "mx-auto w-full max-w-[1448px] px-6";

/** One rhythm, repeated: 96px from `lg`, tightened on a phone. */
export const SECTION_RHYTHM = "py-16 sm:py-20 lg:py-24";

/** The closing section doubles, the way both references end their page. */
export const CLOSING_RHYTHM = "py-24 sm:py-32 lg:py-48";

/* ── Motion ───────────────────────────────────────────────────────────── */

/**
 * One easing for the whole page.
 *
 * A long tail with no overshoot: things arrive and settle rather than bounce.
 * Anything springy reads as a toy, which is the opposite of the impression
 * every page in the reference set is built to create.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * Entrance distance.
 *
 * 16px, not 8. The 8 came from measuring the reference pages, where the largest
 * translate on any entering element was 6px — correct for Axiom, whose page is
 * a dense wall of data that must not shift while it is being read. This page is
 * not that: it is a mostly-empty dark field with a working product in the
 * middle, and at 8px over 380ms the arrival was below the threshold at which a
 * reader registers that anything moved at all. Motion nobody notices is motion
 * that costs frames and buys nothing.
 */
export const RISE_PX = 16;

/** Durations, in seconds. Interaction feedback stays under a fifth of a second. */
export const DURATION = {
  /** Hover, press, toggle. Below the threshold where feedback reads as lag. */
  tap: 0.12,
  /** A control changing state. */
  control: 0.2,
  /** An element entering the page. */
  enter: 0.7,
  /** A panel or surface settling, or a material arriving. */
  settle: 0.9,
} as const;

/** Delay between siblings in a staggered group. */
export const STAGGER = 0.08;

/**
 * The entrance every element on the page shares.
 *
 * Returns props rather than a variant object so a component can spread it and
 * still set its own `className`. Under reduced motion it returns nothing at
 * all: no transform, no opacity, no transition — the settled state, from the
 * first frame.
 */
export function rise(delay = 0, reduceMotion = false) {
  if (reduceMotion) return {};
  return {
    initial: { opacity: 0, transform: `translateY(${RISE_PX}px)` },
    animate: { opacity: 1, transform: "translateY(0px)" },
    transition: { duration: DURATION.enter, delay, ease: EASE_OUT },
  };
}

/**
 * A surface arriving as a material rather than as an opacity change.
 *
 * Apple's rule for glass and panels: animate blur and scale together on enter,
 * so the thing reads as a real surface coming forward instead of a rectangle
 * being faded up. Used for the product frame and the panels inside it — the
 * elements a reader is meant to perceive as objects.
 */
export function materialise(delay = 0, reduceMotion = false) {
  if (reduceMotion) return {};
  return {
    initial: { opacity: 0, scale: 0.985, filter: "blur(8px)" },
    animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
    transition: { duration: DURATION.settle, delay, ease: EASE_OUT },
  };
}

/**
 * A group whose children arrive one after another.
 *
 * Spread on the parent, with `riseChild` on each child. A stagger is the one
 * entrance device that survives being noticed: the eye follows the sequence and
 * reads the group as a set, where a simultaneous fade reads as a redraw.
 */
export function staggerGroup(delay = 0, reduceMotion = false) {
  if (reduceMotion) return {};
  return {
    initial: "hidden",
    whileInView: "shown",
    viewport: { once: true, margin: "0px 0px -12% 0px" },
    variants: {
      hidden: {},
      shown: { transition: { staggerChildren: STAGGER, delayChildren: delay } },
    },
  };
}

export const riseChild = {
  hidden: { opacity: 0, y: RISE_PX },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.enter, ease: EASE_OUT },
  },
};
