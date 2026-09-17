import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BODY_CLASS,
  CLOSING_RHYTHM_CLASS,
  CONTAINER_CLASS,
  DISPLAY_CLASS,
  LEAD_CLASS,
  MICRO_LABEL_CLASS,
  SECTION_HEADING_CLASS,
  SECTION_RHYTHM_CLASS,
} from "../type-scale";

const read = (relative: string) =>
  readFileSync(join(process.cwd(), relative), "utf8");

/**
 * The public type scale is a measured contract, not a preference.
 *
 * Every value here was taken off axiom.co, linear.app and cursor.com with
 * getComputedStyle on 18 Aug 2026 and written up in
 * docs/product-transformation/axiom-visual-benchmark-2026-08-18.md. Three rules
 * held across products that never spoke to each other, and RIFT was outside all
 * three: display weight never reaches 600, tracking sits near -0.025em, and the
 * vertical rhythm is one constant repeated without exception.
 *
 * The failure mode this guards is not a typo. It is the slow return of
 * `text-[clamp(1.9rem,3.9vw,3rem)]` — a heading that looks fine in review and
 * renders at 48.3px, which cannot be checked against anything.
 */
describe("public type scale", () => {
  it("keeps display weight below 600, the way every measured reference does", () => {
    // vercel.com, 20 Aug 2026: h1 is 64px at weight 400, h2 56px at 450. The
    // rule this guards has never been a specific weight — it is that display
    // type on these pages never reaches 600, and Vercel sets the lightest of
    // anyone measured. font-semibold (600) is what made the old hero shout.
    expect(DISPLAY_CLASS).toContain("font-normal");
    expect(DISPLAY_CLASS).not.toContain("font-semibold");
    expect(DISPLAY_CLASS).not.toContain("font-bold");

    // 450, vercel.com's own h2 weight. It was 510 for a day, taken off
    // linear.app; both are variable-font values no static cut offers, and the
    // point of testing for an exact number rather than a range is that it
    // records which page the value came from. The rule underneath has not
    // moved: display type here never reaches 600.
    expect(SECTION_HEADING_CLASS).toContain("font-[450]");
    expect(SECTION_HEADING_CLASS).not.toContain("font-semibold");
    expect(SECTION_HEADING_CLASS).not.toContain("font-bold");
  });

  it("tracks display type at vercel.com's -0.06em", () => {
    // Measured on vercel.com, 20 Aug 2026: h1 -3.84px on 64px and h2 -3.36px
    // on 56px, both exactly -0.06em. That is more than twice the tracking of
    // anything else in this reference set — linear.app sits at -0.022em — and
    // it is the single most recognisable thing about Vercel's typography. It
    // is only safe at this size; the body scale below is untouched.
    expect(DISPLAY_CLASS).toContain("tracking-[-0.06em]");
    expect(SECTION_HEADING_CLASS).toContain("tracking-[-0.055em]");
  });

  it("sizes the hero above the section heading so they never compete", () => {
    // vercel.com's own pair: 64 over 56.
    expect(DISPLAY_CLASS).toContain("md:text-[64px]");
    expect(SECTION_HEADING_CLASS).toContain("lg:text-[56px]");
  });

  it("states every size as a fixed step, never a viewport multiplication", () => {
    for (const value of [
      DISPLAY_CLASS,
      SECTION_HEADING_CLASS,
      LEAD_CLASS,
      BODY_CLASS,
      MICRO_LABEL_CLASS,
      SECTION_RHYTHM_CLASS,
      CLOSING_RHYTHM_CLASS,
      CONTAINER_CLASS,
    ]) {
      expect(value).not.toMatch(/clamp\(/);
      expect(value).not.toMatch(/\d(vw|vh)/);
    }
  });

  it("derives secondary text from the foreground rather than a separate grey", () => {
    expect(LEAD_CLASS).toContain("text-foreground/60");
    expect(BODY_CLASS).toContain("text-foreground/60");
  });

  it("holds the content column at vercel.com's measured 1448px", () => {
    // Measured on vercel.com at a 1512px viewport, 20 Aug 2026: the container
    // caps at max-width 1448 with 24px of padding, and the headline starts at
    // x=56 — 1400px of content. 1240 was axiom.co's, and against Vercel it
    // reads as a column on a page rather than as the page.
    expect(CONTAINER_CLASS).toContain("max-w-[1448px]");
    expect(CONTAINER_CLASS).toContain("px-6");
  });

  it("gives the closing section more room than a body section", () => {
    expect(SECTION_RHYTHM_CLASS).toContain("md:py-24");
    expect(CLOSING_RHYTHM_CLASS).toContain("md:py-48");
  });
});

describe("public pages consume the scale", () => {
  // LandingHero.tsx was rebuilt by a second session working the same branch and
  // now runs on its own scale module. The hero this contract governs is
  // MergedHero.tsx, which is the one `/landing/v4` renders; pointing the guard
  // at a file another author owns would make it fail on their correct code.
  // MarketingPage.tsx is no longer in this list, and it is no longer in this
  // directory. It was landing-v2's shell for every public page that is not the
  // landing; it is now built entirely on landing-x's system and lives in
  // app/components/marketing/. A guard that requires it to import *this*
  // tree's scale would fail on correct code and, worse, would push it back
  // onto a scale its pages no longer use.
  const pages = [
    "app/components/landing-v2/MergedHero.tsx",
    "app/components/landing-v2/Reveal.tsx",
    "app/components/landing-v2/LandingFooter.tsx",
    "app/components/landing-v2/LandingNav.tsx",
  ];

  it.each(pages)("%s imports the scale instead of restating it", (page) => {
    // Two scale modules exist while the merge lands: type-scale.ts for the
    // sections and landing-design-system.ts for the merged page. Either
    // satisfies the rule the guard exists for — the page consumes a scale
    // rather than restating one.
    const source = read(page);
    expect(
      source.includes('from "./type-scale"') ||
        source.includes('from "./landing-design-system"'),
    ).toBe(true);
  });

  it.each(pages)("%s has no viewport-derived heading left in it", (page) => {
    const source = read(page);
    // A clamp() on a font-size or a section padding is the pattern that
    // produced 64.8px and 83.64px on the rendered page.
    expect(source).not.toMatch(/text-\[clamp\(/);
    expect(source).not.toMatch(/py-\[clamp\(/);
    expect(source).not.toMatch(/max-w-\[1100px\]/);
  });

  it("puts the hero's primary control above the product panel", () => {
    const hero = read("app/components/landing-v2/MergedHero.tsx");
    // Every page measured for the benchmark offers the way in before showing
    // the application; ours offered it after 600px of panel. The control is now
    // an input rather than a button — okara.ai and v0 both open on a working
    // one — so the guard tracks the form, not the old button label.
    const control = hero.indexOf("<motion.form");
    expect(control).toBeGreaterThan(-1);
    expect(control).toBeLessThan(hero.indexOf("<RiftMiniApp"));
  });

  it("wires the hero input to the frame below rather than to another page", () => {
    const hero = read("app/components/landing-v2/MergedHero.tsx");
    // A landing-page input that only navigates is a search box with extra
    // steps. This one has to drive the running frame.
    expect(hero).toContain("miniAppRef.current?.run(");
    expect(hero).toContain("ref={miniAppRef}");
  });

  it("pins the brand face so the workspace font preference cannot reach it", () => {
    // Pinned, and pinned to the product's own face: the site and the app are
    // one product, so signing up must not change the typeface underneath the
    // reader. `fontFamily` has to be declared alongside the token because
    // <body> already resolved its own value.
    const palette = read("app/components/landing-v2/palette.ts");
    expect(palette).toContain("fontFamily:");
    expect(palette).toContain("-apple-system, BlinkMacSystemFont");
    expect(palette).not.toContain("--font-geist");
  });
});
