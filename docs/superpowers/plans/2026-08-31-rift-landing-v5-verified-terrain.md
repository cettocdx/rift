# RIFT Landing V5 Verified Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new cinematic, responsive, accessible RIFT landing page at `/landing/v5` without modifying the current homepage or any existing landing route.

**Architecture:** `/landing/v5` is a thin server route that injects development-only font CSS and renders a new component tree under `app/components/landing-v5`. Static marketing content stays typed and centralized; only navigation, reveal motion, and the draggable Connect field are client components. Real product claims reuse existing pricing and connector sources, while development-only concept personas are served through a production-blocked local asset route.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Tailwind CSS 4, CSS Modules, `motion/react`, Canvas 2D, Jest + Testing Library, Playwright.

## Global Constraints

- Create only `/landing/v5`; do not change `/`, `/landing/x`, or `app/(chat)/page.tsx`.
- Use the approved hero copy: `Give it the work. Get back proof.`
- Route `Start building` to `/signup` and `Log in` to `/login`.
- Use the supplied 1500 × 500 landscape as the hero base.
- Build all new UI under `app/components/landing-v5/`; do not modify `landing-x`.
- CursorGothic is development-only until licensed; no Cursor CDN URL or font binary may appear in a production build.
- Synthetic personas are development-only, visibly labelled, and never presented as real customers.
- Build is primary; Studio and Hack are secondary proof surfaces.
- Use `motion/react`; do not add Three.js or another animation dependency.
- Animate transform and opacity by default; never use `transition: all` or scroll-jacking.
- Respect `prefers-reduced-motion` and preserve all information without motion.
- Use window scrolling so the navigation and document share one scroll root.
- Mobile product evidence must be composed for mobile, not a uniformly scaled desktop screenshot.
- Preserve unrelated user changes and commits.

---

## File Structure

### New route files

- `app/landing/v5/page.tsx` — metadata, development font CSS, route entry.
- `app/landing/v5/V5Landing.module.css` — V5-only surfaces, topography, keyframes, responsive and reduced-motion rules.
- `app/landing/v5/__tests__/page.test.tsx` — route contract and production font safety.
- `app/api/landing-v5-concept/[persona]/route.ts` — development-only local concept image response.
- `app/api/landing-v5-concept/[persona]/__tests__/route.test.ts` — production denial and safe-name tests.

### New landing components

- `app/components/landing-v5/V5Landing.tsx` — section composition and `MotionConfig`.
- `app/components/landing-v5/V5Nav.tsx` — shared-scroll navigation and mobile menu.
- `app/components/landing-v5/V5Hero.tsx` — cinematic image, brand expansion, CTAs, compact run panel.
- `app/components/landing-v5/V5RunProof.tsx` — receipt and four-step verification mechanism.
- `app/components/landing-v5/V5ProductSurfaces.tsx` — Build-primary product composition.
- `app/components/landing-v5/V5ConnectField.tsx` — canvas field, pointer physics, keyboard alternative.
- `app/components/landing-v5/V5ProofAndPricing.tsx` — public runs, development concept personas, trust, pricing, close, footer.
- `app/components/landing-v5/V5Reveal.tsx` — one-shot accessible section reveal.
- `app/components/landing-v5/v5-content.ts` — typed copy, proof data, section IDs, public run stories.
- `app/components/landing-v5/v5-font.ts` — pure development font CSS builder.
- `app/components/landing-v5/v5-globe.ts` — pure sphere math and constants.
- `app/components/landing-v5/__tests__/V5Landing.test.tsx` — semantic and conversion contract.
- `app/components/landing-v5/__tests__/V5Nav.test.tsx` — navigation and menu behavior.
- `app/components/landing-v5/__tests__/v5-globe.test.ts` — deterministic sphere math.
- `app/components/landing-v5/__tests__/V5ConnectField.test.tsx` — keyboard alternative and labels.
- `app/components/landing-v5/__tests__/production-safety.test.ts` — source-level production leak guards.

### New assets and browser checks

- `public/landing-v5/rift-terrain-base.jpeg` — approved 1500 × 500 hero asset.
- `.local-assets/rift-v5/personas/*.webp` — local-only generated concept portraits; never committed.
- `e2e/landing-v5.spec.ts` — desktop, mobile, navigation, reduced-motion, and overflow checks.

---

### Task 1: Route contract, font guard, and landing shell

**Files:**
- Create: `app/landing/v5/page.tsx`
- Create: `app/landing/v5/__tests__/page.test.tsx`
- Create: `app/components/landing-v5/V5Landing.tsx`
- Create: `app/components/landing-v5/v5-font.ts`

**Interfaces:**
- Produces: `buildV5DevelopmentFontCss(input: V5FontInput): string`
- Produces: `V5Landing({ developmentConcepts }: { developmentConcepts: boolean }): JSX.Element`
- Consumes later: every section component is imported into `V5Landing` as tasks complete.

- [ ] **Step 1: Write the failing route and font-safety tests**

```tsx
// app/landing/v5/__tests__/page.test.tsx
import { render, screen } from "@testing-library/react";
import { buildV5DevelopmentFontCss } from "@/app/components/landing-v5/v5-font";
import { V5Landing } from "@/app/components/landing-v5/V5Landing";

describe("RIFT landing V5 foundation", () => {
  it("renders the approved proposition and conversion path", () => {
    render(<V5Landing developmentConcepts={false} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Give it the work. Get back proof.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start building" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("emits temporary font CSS only in development", () => {
    const sources = {
      regular: "https://example.test/cursor-regular.woff2",
      bold: "https://example.test/cursor-bold.woff2",
    };
    expect(
      buildV5DevelopmentFontCss({ runtime: "production", sources }),
    ).toBe("");
    expect(
      buildV5DevelopmentFontCss({ runtime: "development", sources }),
    ).toContain("font-family:CursorGothic");
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run:

```bash
pnpm jest app/landing/v5/__tests__/page.test.tsx --runInBand
```

Expected: FAIL because `V5Landing` and `v5-font` do not exist.

- [ ] **Step 3: Implement the pure font builder**

```ts
// app/components/landing-v5/v5-font.ts
export type V5FontSources = {
  regular?: string;
  italic?: string;
  bold?: string;
  boldItalic?: string;
};

export type V5FontInput = {
  runtime: string | undefined;
  sources: V5FontSources;
};

const face = (
  source: string | undefined,
  weight: 400 | 700,
  style: "normal" | "italic",
) =>
  source
    ? `@font-face{font-family:CursorGothic;src:url("${source}") format("woff2");font-display:swap;font-weight:${weight};font-style:${style};}`
    : "";

export function buildV5DevelopmentFontCss({
  runtime,
  sources,
}: V5FontInput): string {
  if (runtime !== "development") return "";
  return [
    face(sources.regular, 400, "normal"),
    face(sources.italic, 400, "italic"),
    face(sources.bold, 700, "normal"),
    face(sources.boldItalic, 700, "italic"),
  ]
    .filter(Boolean)
    .join("\n");
}
```

- [ ] **Step 4: Implement the route and minimal semantic shell**

```tsx
// app/components/landing-v5/V5Landing.tsx
import type { ReactElement } from "react";

export function V5Landing({
  developmentConcepts: _developmentConcepts,
}: {
  developmentConcepts: boolean;
}): ReactElement {
  return (
    <div data-v5-root>
      <a href="#v5-main">Skip to content</a>
      <main id="v5-main">
        <h1>Give it the work. Get back proof.</h1>
        <a href="/signup">Start building</a>
      </main>
    </div>
  );
}
```

```tsx
// app/landing/v5/page.tsx
import type { Metadata } from "next";
import { V5Landing } from "@/app/components/landing-v5/V5Landing";
import { buildV5DevelopmentFontCss } from "@/app/components/landing-v5/v5-font";

export const metadata: Metadata = {
  title: "RIFT — Give it the work. Get back proof.",
  description:
    "RIFT executes professional work on a real machine, verifies the result, and returns the trace and exact cost.",
};

export default function LandingV5Page() {
  const runtime = process.env.NODE_ENV;
  const fontCss = buildV5DevelopmentFontCss({
    runtime,
    sources: {
      regular: process.env.NEXT_PUBLIC_RIFT_V5_FONT_REGULAR_URL,
      italic: process.env.NEXT_PUBLIC_RIFT_V5_FONT_ITALIC_URL,
      bold: process.env.NEXT_PUBLIC_RIFT_V5_FONT_BOLD_URL,
      boldItalic: process.env.NEXT_PUBLIC_RIFT_V5_FONT_BOLD_ITALIC_URL,
    },
  });

  return (
    <>
      {fontCss ? <style dangerouslySetInnerHTML={{ __html: fontCss }} /> : null}
      <V5Landing developmentConcepts={runtime === "development"} />
    </>
  );
}
```

- [ ] **Step 5: Run the focused test and typecheck the new files**

Run:

```bash
pnpm jest app/landing/v5/__tests__/page.test.tsx --runInBand
pnpm typecheck
```

Expected: focused test PASS; typecheck PASS.

- [ ] **Step 6: Commit the foundation**

```bash
git add app/landing/v5 app/components/landing-v5/V5Landing.tsx app/components/landing-v5/v5-font.ts
git commit -m "feat: scaffold RIFT landing v5"
```

---

### Task 2: V5 visual system, content model, and navigation

**Files:**
- Create: `app/landing/v5/V5Landing.module.css`
- Create: `app/components/landing-v5/v5-content.ts`
- Create: `app/components/landing-v5/V5Nav.tsx`
- Create: `app/components/landing-v5/__tests__/V5Nav.test.tsx`
- Modify: `app/components/landing-v5/V5Landing.tsx`

**Interfaces:**
- Produces: `V5RunProof`, `V5Step`, `V5Surface`, `V5PublicRun` types.
- Produces: `V5Nav(): JSX.Element`.
- Consumes: `RiftLogo`, `/signup`, `/login`, window scroll.

- [ ] **Step 1: Write navigation behavior tests**

```tsx
// app/components/landing-v5/__tests__/V5Nav.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { V5Nav } from "../V5Nav";

describe("V5Nav", () => {
  it("keeps the primary conversion and login routes explicit", () => {
    render(<V5Nav />);
    expect(screen.getByRole("link", { name: "Start building" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("opens and closes the accessible mobile menu", () => {
    render(<V5Nav />);
    const button = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "Mobile" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails because `V5Nav` is missing**

Run:

```bash
pnpm jest app/components/landing-v5/__tests__/V5Nav.test.tsx --runInBand
```

Expected: FAIL with module-not-found for `V5Nav`.

- [ ] **Step 3: Add typed shared content**

```ts
// app/components/landing-v5/v5-content.ts
export type V5RunProof = {
  tools: number;
  changedLines: number;
  checks: string;
  context: string;
  cost: string;
};

export type V5Step = {
  number: string;
  title: string;
  body: string;
};

export type V5Surface = {
  id: "build" | "studio" | "hack";
  title: string;
  eyebrow: string;
  body: string;
  outcome: string;
};

export type V5PublicRun = {
  id: string;
  mode: string;
  title: string;
  result: string;
  cost: string;
};

export const V5_RUN_PROOF: V5RunProof = {
  tools: 12,
  changedLines: 491,
  checks: "28/28",
  context: "41K",
  cost: "$2.10",
};

export const V5_STEPS: V5Step[] = [
  { number: "01", title: "Scope", body: "Understands the goal, repository, and constraints." },
  { number: "02", title: "Execute", body: "Uses files, terminal, browser, and connected tools." },
  { number: "03", title: "Verify", body: "Runs the checks the result actually needs." },
  { number: "04", title: "Return proof", body: "Shows the actions, output, trace, and exact cost." },
];

export const V5_SURFACES: V5Surface[] = [
  { id: "build", title: "Build", eyebrow: "Primary surface", body: "From task to verified change on a real machine.", outcome: "28 checks passed" },
  { id: "studio", title: "Studio", eyebrow: "Same context", body: "Create media and model output without restarting the workflow.", outcome: "Output rendered" },
  { id: "hack", title: "Hack", eyebrow: "Authorised scope", body: "Investigate systems and retain evidence with the run.", outcome: "Finding verified" },
];

export const V5_PUBLIC_RUNS: V5PublicRun[] = [
  { id: "RUN-2841", mode: "BUILD", title: "Gravity simulation", result: "Rendered and tested", cost: "$2.10" },
  { id: "RUN-2817", mode: "FIX", title: "Production regression", result: "Reproduced, patched, verified", cost: "$1.84" },
  { id: "RUN-2794", mode: "AUDIT", title: "Authorised scan", result: "Evidence retained", cost: "$3.06" },
];
```

- [ ] **Step 4: Implement the shared visual tokens and responsive primitives**

Create `app/landing/v5/V5Landing.module.css` with these exact root tokens and rules:

```css
.root {
  --v5-paper: #f5f4ef;
  --v5-paper-raised: #ebe8df;
  --v5-ink: #161713;
  --v5-muted: rgba(22, 23, 19, 0.62);
  --v5-line: rgba(22, 23, 19, 0.14);
  --v5-night: #0b0c0b;
  --v5-night-line: rgba(255, 255, 255, 0.12);
  --v5-signal: #73dda2;
  --v5-rust: #a95737;
  --v5-sand: #d5b36e;
  min-height: 100%;
  overflow-x: clip;
  background: var(--v5-paper);
  color: var(--v5-ink);
  font-family: CursorGothic, "Helvetica Neue", Helvetica, Arial, system-ui,
    sans-serif;
}

.container {
  width: min(100%, 1440px);
  margin-inline: auto;
  padding-inline: clamp(20px, 3vw, 44px);
}

.skipLink {
  position: fixed;
  z-index: 100;
  left: 16px;
  top: 12px;
  transform: translateY(-160%);
  border-radius: 999px;
  background: #fff;
  color: #111;
  padding: 10px 14px;
}

.skipLink:focus-visible { transform: translateY(0); }
.section { padding-block: clamp(80px, 10vw, 148px); scroll-margin-top: 84px; }
.display { font-size: clamp(36px, 4.4vw, 64px); line-height: 1; letter-spacing: -0.025em; font-weight: 400; text-wrap: balance; }
.body { max-width: 65ch; font-size: clamp(16px, 1.3vw, 18px); line-height: 1.55; color: var(--v5-muted); }

@media (prefers-reduced-motion: reduce) {
  .root *, .root *::before, .root *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 5: Implement `V5Nav` with window scroll and mobile menu**

Implement `V5Nav.tsx` as a client component with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { RiftLogo } from "@/components/icons/rift-logo";
import styles from "@/app/landing/v5/V5Landing.module.css";

const LINKS = [
  { label: "Product", href: "#product" },
  { label: "Runs", href: "#runs" },
  { label: "Security", href: "#security" },
  { label: "Pricing", href: "#pricing" },
] as const;

export function V5Nav() {
  const [lifted, setLifted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 12);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className={styles.nav} data-lifted={lifted || undefined}>
      <div className={`${styles.container} ${styles.navInner}`}>
        <a href="#top" aria-label="RIFT home" className={styles.brand}>
          <RiftLogo size={20} />
          <span>RIFT</span>
        </a>
        <nav aria-label="Primary" className={styles.desktopNav}>
          {LINKS.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
        </nav>
        <div className={styles.navActions}>
          <a href="/login" className={styles.login}>Log in</a>
          <a href="/signup" className={styles.primaryButton}>Start building</a>
          <button
            type="button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="v5-mobile-nav"
            className={styles.menuButton}
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden>{open ? "×" : "≡"}</span>
          </button>
        </div>
      </div>
      <nav id="v5-mobile-nav" aria-label="Mobile" hidden={!open} className={styles.mobileNav}>
        {LINKS.map((link) => <a key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</a>)}
        <a href="/login">Log in</a>
      </nav>
    </header>
  );
}
```

Add explicit CSS module rules for 68px desktop height, 58px mobile height,
transparent initial state, `background: color-mix(in srgb, #26312f 82%, transparent)`
when lifted, and a mobile menu below 760px. Use property-specific transitions.

- [ ] **Step 6: Compose the nav and skip link into `V5Landing`**

Wrap the route in `MotionConfig reducedMotion="user"`, apply `styles.root`, and
render `V5Nav` before `<main id="v5-main">`.

- [ ] **Step 7: Run focused tests and commit**

```bash
pnpm jest app/components/landing-v5/__tests__/V5Nav.test.tsx app/landing/v5/__tests__/page.test.tsx --runInBand
pnpm typecheck
git add app/landing/v5 app/components/landing-v5
git commit -m "feat: add V5 design system and navigation"
```

Expected: tests PASS; typecheck PASS.

---

### Task 3: Cinematic hero and immediate run proof

**Files:**
- Create: `app/components/landing-v5/V5Hero.tsx`
- Create: `app/components/landing-v5/V5RunProof.tsx`
- Create: `app/components/landing-v5/V5Reveal.tsx`
- Create: `app/components/landing-v5/__tests__/V5Landing.test.tsx`
- Create: `public/landing-v5/rift-terrain-base.jpeg`
- Modify: `app/components/landing-v5/V5Landing.tsx`
- Modify: `app/landing/v5/V5Landing.module.css`

**Interfaces:**
- Consumes: `V5_RUN_PROOF`, `V5_STEPS`, `styles`.
- Produces: `V5Hero`, `V5RunProof`, `V5Reveal`.

- [ ] **Step 1: Write the semantic hero and proof test**

```tsx
// app/components/landing-v5/__tests__/V5Landing.test.tsx
import { render, screen, within } from "@testing-library/react";
import { V5Landing } from "../V5Landing";

describe("V5Landing story", () => {
  it("moves from proposition to inspectable proof before product breadth", () => {
    render(<V5Landing developmentConcepts={false} />);
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Give it the work. Get back proof.",
    );
    expect(within(main).getByText("Recursive Intelligence for Technology")).toBeInTheDocument();
    expect(within(main).getByText("28/28")).toBeInTheDocument();
    expect(within(main).getByText("$2.10")).toBeInTheDocument();
    expect(within(main).getByRole("heading", { name: "How a run earns done." })).toBeInTheDocument();
  });

  it("provides explicit dimensions and alt text for the hero image", () => {
    render(<V5Landing developmentConcepts={false} />);
    const image = screen.getByAltText(
      "Soft grassland and layered mountain ridges at sunrise",
    );
    expect(image).toHaveAttribute("width", "1500");
    expect(image).toHaveAttribute("height", "500");
  });
});
```

- [ ] **Step 2: Run the test and confirm missing hero/proof content**

```bash
pnpm jest app/components/landing-v5/__tests__/V5Landing.test.tsx --runInBand
```

Expected: FAIL on the brand expansion and proof assertions.

- [ ] **Step 3: Copy the approved binary hero asset without modifying the source**

```bash
mkdir -p public/landing-v5
cp '/Users/cetto/Desktop/1500x500 (1).jpeg' public/landing-v5/rift-terrain-base.jpeg
```

Verify:

```bash
file public/landing-v5/rift-terrain-base.jpeg
```

Expected: JPEG, 1500 × 500.

- [ ] **Step 4: Implement one-shot reveal and hero composition**

`V5Reveal` uses `motion.div` with `initial={{ opacity: 0, y: 10, filter:
"blur(3px)" }}`, `whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}`,
`viewport={{ once: true, amount: 0.2 }}`, and a 600ms cubic-bezier transition.

`V5Hero` must render:

- the 1500 × 500 `next/image` with `priority`, `sizes="100vw"`, and the tested alt;
- decorative topographic layers with `aria-hidden`;
- the RIFT expansion;
- approved kicker, H1, lede, `/signup`, and `#runs` CTAs;
- a compact black run panel using `V5_RUN_PROOF`;
- a mobile DOM order of copy first, run panel second.

The H1 is the only H1 on the route. Use `motion` for the initial copy and panel
settle; use CSS keyframes only for the slow terrain and fog loops.

- [ ] **Step 5: Implement receipt and four-stage mechanism**

`V5RunProof` renders:

```tsx
<section id="runs" aria-labelledby="v5-runs-title">
  <p>Real run · inspect the receipt</p>
  <h2 id="v5-runs-title">Don’t trust the claim. Inspect the run.</h2>
  <dl>
    <div><dt>Tools</dt><dd>12</dd></div>
    <div><dt>Change</dt><dd>+491 lines</dd></div>
    <div><dt>Checks</dt><dd>28/28</dd></div>
    <div><dt>Context</dt><dd>41K</dd></div>
    <div><dt>Total</dt><dd>$2.10</dd></div>
  </dl>
  <h2>How a run earns done.</h2>
  <ol>{V5_STEPS.map(/* numbered semantic step */)}</ol>
</section>
```

Use actual `<dl>` and `<ol>` elements, not div-only imitations.

- [ ] **Step 6: Add exact hero and proof CSS**

Add:

- hero minimum 680px desktop and auto-height mobile;
- image `object-fit: cover` and `object-position: center 48%`;
- 18-second alternate terrain transform loop;
- 13-second fog transform/opacity loop;
- contour background moving no faster than 24 seconds per cycle;
- H1 `clamp(48px, 6vw, 84px)`, weight 400, tracking `-0.03em`;
- run panel width `min(420px, 38vw)` and mobile width 100%;
- near-black proof section with warm-white text and green only for verified state;
- reduced-motion static image, expansion, and panel.

- [ ] **Step 7: Run tests, inspect the route, and commit**

```bash
pnpm jest app/components/landing-v5/__tests__/V5Landing.test.tsx app/landing/v5/__tests__/page.test.tsx --runInBand
pnpm typecheck
git add app/components/landing-v5 app/landing/v5 public/landing-v5/rift-terrain-base.jpeg
git commit -m "feat: build cinematic V5 hero and run proof"
```

Expected: tests PASS; typecheck PASS; `/landing/v5` starts with the approved
image, proposition, and receipt.

---

### Task 4: Build-primary product story

**Files:**
- Create: `app/components/landing-v5/V5ProductSurfaces.tsx`
- Modify: `app/components/landing-v5/V5Landing.tsx`
- Modify: `app/landing/v5/V5Landing.module.css`
- Modify: `app/components/landing-v5/__tests__/V5Landing.test.tsx`

**Interfaces:**
- Consumes: `V5_SURFACES`.
- Produces: `V5ProductSurfaces(): JSX.Element` with section id `product`.

- [ ] **Step 1: Extend the story test with hierarchy and mobile composition contracts**

```tsx
it("makes Build primary without shrinking a desktop screenshot on mobile", () => {
  render(<V5Landing developmentConcepts={false} />);
  const product = screen.getByRole("region", { name: "One agent layer. Three serious surfaces." });
  expect(within(product).getByRole("heading", { name: "Build" })).toBeInTheDocument();
  expect(within(product).getByRole("heading", { name: "Studio" })).toBeInTheDocument();
  expect(within(product).getByRole("heading", { name: "Hack" })).toBeInTheDocument();
  expect(product).not.toHaveAttribute("data-desktop-scale");
  expect(within(product).getByText("28 checks passed")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and confirm the missing product region**

```bash
pnpm jest app/components/landing-v5/__tests__/V5Landing.test.tsx --runInBand
```

Expected: FAIL because the named product region does not exist.

- [ ] **Step 3: Implement `V5ProductSurfaces`**

Render one section with:

- heading `One agent layer. Three serious surfaces.`;
- a two-column desktop grid where Build spans the left two-thirds;
- a Build execution scene containing task, file changes, command checks, and
  `28 checks passed`;
- Studio and Hack supporting cards in the right column;
- separate compact mobile evidence blocks selected by CSS layout, not a scaled
  1440px stage;
- links to `/signup`, `/studio`, and `/hack` only where those routes exist;
- no iframe, autoplay video, or fake interactive controls.

- [ ] **Step 4: Add product-surface styling and responsive composition**

Use a warm mineral mat around near-black product UI. Build has a minimum 520px
desktop visual; Studio and Hack each have a minimum 250px visual. Below 760px,
all surfaces stack and the execution details remain at least 12px. The CSS must
not contain a uniform `scale()` for product content.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm jest app/components/landing-v5/__tests__/V5Landing.test.tsx --runInBand
pnpm typecheck
git add app/components/landing-v5 app/landing/v5/V5Landing.module.css
git commit -m "feat: add Build-primary V5 product story"
```

Expected: test PASS; typecheck PASS.

---

### Task 5: Verified Terrain Connect field

**Files:**
- Create: `app/components/landing-v5/v5-globe.ts`
- Create: `app/components/landing-v5/V5ConnectField.tsx`
- Create: `app/components/landing-v5/__tests__/v5-globe.test.ts`
- Create: `app/components/landing-v5/__tests__/V5ConnectField.test.tsx`
- Modify: `app/components/landing-v5/V5Landing.tsx`
- Modify: `app/landing/v5/V5Landing.module.css`

**Interfaces:**
- Produces: `Vec3`, `fibSphere`, `rotatePoint`, `clampPitch`.
- Consumes: `MCP_CATALOG`, `hasConfiguredMcpEndpoint`, `logoNeedsPlate`, `RiftLogo`.

- [ ] **Step 1: Write deterministic sphere-math tests**

```ts
// app/components/landing-v5/__tests__/v5-globe.test.ts
import { clampPitch, fibSphere, rotatePoint } from "../v5-globe";

describe("V5 globe math", () => {
  it("places points on the unit sphere", () => {
    const point = fibSphere(20, 7);
    expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(1, 6);
  });

  it("preserves vector length under rotation", () => {
    const rotated = rotatePoint({ x: 1, y: 0, z: 0 }, 0.7, -0.2);
    expect(Math.hypot(rotated.x, rotated.y, rotated.z)).toBeCloseTo(1, 6);
  });

  it("caps pitch to keep the field controllable", () => {
    expect(clampPitch(9)).toBe(1.2);
    expect(clampPitch(-9)).toBe(-1.2);
  });
});
```

- [ ] **Step 2: Write the accessible-interaction test**

```tsx
// app/components/landing-v5/__tests__/V5ConnectField.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { V5ConnectField } from "../V5ConnectField";

describe("V5ConnectField", () => {
  it("offers keyboard controls in addition to pointer drag", () => {
    render(<V5ConnectField />);
    expect(screen.getByRole("region", { name: "Connected tools" })).toBeInTheDocument();
    const left = screen.getByRole("button", { name: "Rotate integrations left" });
    fireEvent.click(left);
    expect(screen.getByText(/Drag the field or use the arrow controls/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run both tests and confirm missing implementations**

```bash
pnpm jest app/components/landing-v5/__tests__/v5-globe.test.ts app/components/landing-v5/__tests__/V5ConnectField.test.tsx --runInBand
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement pure globe math**

```ts
// app/components/landing-v5/v5-globe.ts
export type Vec3 = { x: number; y: number; z: number };

export function fibSphere(count: number, index: number): Vec3 {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / Math.max(1, count - 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * golden;
  return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
}

export function rotatePoint(point: Vec3, yaw: number, pitch: number): Vec3 {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const x = point.x * cosYaw + point.z * sinYaw;
  const z = -point.x * sinYaw + point.z * cosYaw;
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  return {
    x,
    y: point.y * cosPitch - z * sinPitch,
    z: point.y * sinPitch + z * cosPitch,
  };
}

export const clampPitch = (pitch: number) =>
  Math.max(-1.2, Math.min(1.2, pitch));
```

- [ ] **Step 5: Implement the canvas field and direct manipulation**

Adapt the proven zero-rerender canvas loop from `XKnowledgeGlobe` into a new
component without importing the old component. Required constants:

```ts
const DPR_CAP = 2;
const DOT_COUNT = 220;
const ORBIT_COUNT = 7;
const IDLE_YAW = 0.0012;
const FRICTION = 0.94;
const VELOCITY_FLOOR = 0.0014;
const DRAG_SENSITIVITY = 0.007;
```

Required behavior:

- canvas draws seven topographic orbit paths and 220 depth-aware dots;
- configured connectors are projected as HTML image pucks;
- pointer capture gives 1:1 drag and release velocity;
- loop runs only while intersecting and page visibility is `visible`;
- reduced motion disables idle drift and release coast but keeps direct drag;
- left/right/up/down buttons update refs by 0.14 radians and call `draw()`;
- host uses `touch-action: pan-y` so vertical page scrolling remains available;
- each connector image retains its real product name as alt text.

- [ ] **Step 6: Add field styling and compose it after product surfaces**

The section uses a 42/58 text-to-field desktop split, a 480px maximum sphere,
warm paper ground, and faint mineral contour traces. Below 760px, text appears
first and the field is 340px high. Controls remain visible at all widths.

- [ ] **Step 7: Run tests and commit**

```bash
pnpm jest app/components/landing-v5/__tests__/v5-globe.test.ts app/components/landing-v5/__tests__/V5ConnectField.test.tsx --runInBand
pnpm typecheck
git add app/components/landing-v5 app/landing/v5/V5Landing.module.css
git commit -m "feat: add draggable Verified Terrain connect field"
```

Expected: focused tests PASS; typecheck PASS.

---

### Task 6: Public proof, development concept people, trust, pricing, and close

**Files:**
- Create: `app/components/landing-v5/V5ProofAndPricing.tsx`
- Create: `app/api/landing-v5-concept/[persona]/route.ts`
- Create: `app/api/landing-v5-concept/[persona]/__tests__/route.test.ts`
- Modify: `app/components/landing-v5/V5Landing.tsx`
- Modify: `app/components/landing-v5/__tests__/V5Landing.test.tsx`
- Modify: `app/landing/v5/V5Landing.module.css`
- Create locally, do not commit: `.local-assets/rift-v5/personas/founder.webp`
- Create locally, do not commit: `.local-assets/rift-v5/personas/staff-engineer.webp`
- Create locally, do not commit: `.local-assets/rift-v5/personas/product-engineer.webp`
- Create locally, do not commit: `.local-assets/rift-v5/personas/security-lead.webp`

**Interfaces:**
- Consumes: `V5_PUBLIC_RUNS`, `PLANS` from `@/lib/pricing/plans`.
- Produces: `V5ProofAndPricing({ developmentConcepts: boolean }): JSX.Element`.
- Produces: GET route returning a local image only in development.

- [ ] **Step 1: Write production-safe concept asset route tests**

```ts
// app/api/landing-v5-concept/[persona]/__tests__/route.test.ts
import { serveV5ConceptPersona } from "../route";

describe("landing V5 concept persona route", () => {
  it("returns 404 outside development", async () => {
    const response = await serveV5ConceptPersona("founder", "production");
    expect(response.status).toBe(404);
  });

  it("rejects names outside the explicit persona map", async () => {
    const response = await serveV5ConceptPersona("secret", "development");
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Add the landing social-proof contract test**

```tsx
it("shows public run proof in production and labels development concepts", () => {
  const { rerender } = render(<V5Landing developmentConcepts={false} />);
  expect(screen.getByText("RUN-2841")).toBeInTheDocument();
  expect(screen.queryByText("Synthetic preview")).not.toBeInTheDocument();

  rerender(<V5Landing developmentConcepts />);
  expect(screen.getAllByText("Synthetic preview")).toHaveLength(4);
});
```

- [ ] **Step 3: Run tests and verify missing route and proof components**

```bash
pnpm jest app/api/landing-v5-concept/[persona]/__tests__/route.test.ts app/components/landing-v5/__tests__/V5Landing.test.tsx --runInBand
```

Expected: FAIL because the route and social proof component do not exist.

- [ ] **Step 4: Implement the development-only image route**

Implement an explicit name map:

```ts
const PERSONAS = {
  founder: "founder.webp",
  "staff-engineer": "staff-engineer.webp",
  "product-engineer": "product-engineer.webp",
  "security-lead": "security-lead.webp",
} as const;
```

Export the testable helper
`serveV5ConceptPersona(persona, runtime = process.env.NODE_ENV)`. The standard
two-argument Next.js `GET(request, context)` handler awaits `context.params` and
delegates to that helper. Return 404 unless `runtime === "development"` and the
key exists. Read only the mapped file from `path.join(process.cwd(),
".local-assets", "rift-v5", "personas")`. Return `image/webp`,
`Cache-Control: no-store`; return 404 on read failure.

- [ ] **Step 5: Generate four clearly fictional adult concept portraits**

Use the `imagegen` skill with one consistent art-direction prompt:

```text
Four distinct fictional adult software professionals for a private localhost
landing-page concept. Natural environmental portraiture, soft dawn light,
muted mineral palette matching blue-grey mountains and amber grassland,
editorial 35mm film texture, straightforward expressions, no logos, no text,
no resemblance to public figures, 4:5 portrait crop. Produce separate people:
technical founder, staff engineer, product engineer, security lead.
```

Save the four outputs to the mapped `.local-assets` files. Add
`.local-assets/rift-v5/` to `.git/info/exclude`, not to the committed tree.

- [ ] **Step 6: Implement public runs, concept people, trust, pricing, and close**

`V5ProofAndPricing` renders in this order:

1. `Real work, left open.` using `V5_PUBLIC_RUNS`.
2. Development-only `Built by people who ship.` with four portrait cards,
   each visibly labelled `Synthetic preview`; cards use role labels only and
   contain no fabricated company, name, or quotation.
3. `Built for work that has to hold up.` with isolation, scoped credentials,
   retained trace, and visible cost.
4. `Start free. Scale when it works.` by mapping the authoritative `PLANS`
   export; do not duplicate price values.
5. `Put RIFT to work.` with `/signup` and `/login` actions.
6. Footer with Product, Start, Company, and Legal links from real routes.

- [ ] **Step 7: Add the editorial dark people section, ruled pricing columns, and closing terrain crop**

Use 4:5 portrait cards on near-black, warm-white copy, and 9px mono concept
labels. Pricing uses ruled columns, not floating cards. The final CTA reuses the
hero image with a different focal crop and a dark scrim; the image remains
decorative there.

- [ ] **Step 8: Run tests and commit only source files**

```bash
pnpm jest app/api/landing-v5-concept/[persona]/__tests__/route.test.ts app/components/landing-v5/__tests__/V5Landing.test.tsx --runInBand
pnpm typecheck
git status --short
git add app/api/landing-v5-concept app/components/landing-v5 app/landing/v5/V5Landing.module.css
git commit -m "feat: complete V5 proof pricing and close"
```

Expected: tests PASS; `.local-assets` does not appear in the commit.

---

### Task 7: Production safety, accessibility, motion, and responsive browser coverage

**Files:**
- Create: `app/components/landing-v5/__tests__/production-safety.test.ts`
- Create: `e2e/landing-v5.spec.ts`
- Modify: V5 component and CSS files only where audit failures require changes.

**Interfaces:**
- Consumes: completed V5 route.
- Produces: source-level leak guards and browser-level behavior coverage.

- [ ] **Step 1: Write source-level production safety tests**

```ts
// app/components/landing-v5/__tests__/production-safety.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("landing V5 production safety", () => {
  it("contains no hard-coded Cursor CDN font URL", () => {
    const files = [
      "app/landing/v5/page.tsx",
      "app/components/landing-v5/v5-font.ts",
      "app/landing/v5/V5Landing.module.css",
    ];
    for (const file of files) expect(source(file)).not.toMatch(/cursor\.com\/.*\.(woff2|otf)/i);
  });

  it("contains no transition-all utility or CSS declaration", () => {
    const files = [
      "app/landing/v5/V5Landing.module.css",
      "app/components/landing-v5/V5Landing.tsx",
      "app/components/landing-v5/V5Nav.tsx",
      "app/components/landing-v5/V5Hero.tsx",
    ];
    for (const file of files) {
      expect(source(file)).not.toContain("transition-all");
      expect(source(file)).not.toMatch(/transition\s*:\s*all/i);
    }
  });
});
```

- [ ] **Step 2: Write the public-route Playwright checks**

```ts
// e2e/landing-v5.spec.ts
import { expect, test } from "@playwright/test";

test.describe("RIFT landing V5", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("desktop route exposes the complete conversion story", async ({ page }) => {
    await page.goto("/landing/v5");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Give it the work. Get back proof.",
    );
    await expect(page.getByRole("link", { name: "Start building" }).first()).toHaveAttribute("href", "/signup");
    await expect(page.getByText("RUN-2841")).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("mobile menu and proof surfaces remain readable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/landing/v5");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
    await expect(page.getByText("28 checks passed")).toBeVisible();
  });

  test("reduced motion preserves content", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/landing/v5");
    await expect(page.getByText("Recursive Intelligence for Technology")).toBeVisible();
    await expect(page.getByRole("region", { name: "Connected tools" })).toBeVisible();
  });
});
```

- [ ] **Step 3: Run unit safety checks and fix only concrete failures**

```bash
pnpm jest app/components/landing-v5/__tests__/production-safety.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Run the UI/UX and motion skill audits**

Use these required skills in order:

1. `ui-ux-pro-max` for layout, hierarchy, responsive, color, and interaction checks.
2. `frontend-design` and `high-end-visual-design` for distinctive visual quality.
3. `motion-design` and `framer-motion-animator` for implementation quality.
4. `review-animations` for an independent motion audit.
5. `accessibility` and `web-design-guidelines` for WCAG and interface checks.
6. `vercel-react-best-practices` for React/Next.js performance.

For every issue, record file and line, fix the issue, and rerun its focused test.

- [ ] **Step 5: Start the route with temporary localhost font environment values and run Playwright**

Start the development server with the four font URLs supplied only in the shell
environment, then run:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3010 pnpm playwright test e2e/landing-v5.spec.ts --project=chromium
PLAYWRIGHT_BASE_URL=http://localhost:3010 pnpm playwright test e2e/landing-v5.spec.ts --project='Mobile Chrome'
```

Expected: all V5 browser tests PASS.

- [ ] **Step 6: Verify production font and concept safety**

Build without development font environment variables:

```bash
env -u NEXT_PUBLIC_RIFT_V5_FONT_REGULAR_URL \
    -u NEXT_PUBLIC_RIFT_V5_FONT_ITALIC_URL \
    -u NEXT_PUBLIC_RIFT_V5_FONT_BOLD_URL \
    -u NEXT_PUBLIC_RIFT_V5_FONT_BOLD_ITALIC_URL \
    pnpm build
```

Then scan:

```bash
if rg -n "cursor\.com/.*(woff2|otf)" .next; then exit 1; fi
```

Then start that production build on an unused local port and request
`/landing/v5`; fail if the returned document contains `Synthetic preview` or a
concept persona asset route. This verifies the user-visible production output
without treating unreachable development-only source strings as a leak.

Expected: build PASS; the font scan and rendered production-route scan return
no matches.

- [ ] **Step 7: Commit audit fixes and browser coverage**

```bash
git add app/components/landing-v5 app/landing/v5 app/api/landing-v5-concept e2e/landing-v5.spec.ts
git commit -m "test: harden RIFT landing v5"
```

---

### Task 8: Final verification and localhost handoff

**Files:**
- Modify only files implicated by verification failures.

**Interfaces:**
- Produces: verified `/landing/v5` localhost experience and final evidence.

- [ ] **Step 1: Run the complete focused V5 test set**

```bash
pnpm jest \
  app/landing/v5/__tests__/page.test.tsx \
  app/components/landing-v5/__tests__/V5Landing.test.tsx \
  app/components/landing-v5/__tests__/V5Nav.test.tsx \
  app/components/landing-v5/__tests__/v5-globe.test.ts \
  app/components/landing-v5/__tests__/V5ConnectField.test.tsx \
  app/components/landing-v5/__tests__/production-safety.test.ts \
  app/api/landing-v5-concept/[persona]/__tests__/route.test.ts \
  --runInBand
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run static verification**

```bash
pnpm typecheck
pnpm eslint app/landing/v5 app/components/landing-v5 app/api/landing-v5-concept e2e/landing-v5.spec.ts --ext .ts,.tsx
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Inspect desktop, mobile, and reduced-motion visuals**

Use browser screenshots at 1440 × 900, 390 × 844, and 390 × 844 with reduced
motion. Verify:

- nav text never overlaps section content;
- hero headline and run panel remain legible;
- landscape focal point survives mobile crop;
- no desktop surface is rendered as unreadable miniature UI;
- Connect drag does not block vertical page scrolling;
- concept portraits are visibly labelled in development;
- final CTA routes to `/signup`.

- [ ] **Step 4: Run final production build and leak scan again**

Repeat Task 7 Step 6 after all fixes. Expected: build PASS, no prohibited font
URL in `.next`, and no concept label or persona asset route in the rendered
production document.

- [ ] **Step 5: Commit final verification fixes if any**

```bash
git add app/landing/v5 app/components/landing-v5 app/api/landing-v5-concept e2e/landing-v5.spec.ts public/landing-v5/rift-terrain-base.jpeg
git commit -m "fix: finish RIFT landing v5 verification"
```

Skip this commit only when Step 1 through Step 4 required no file changes.

- [ ] **Step 6: Leave the approved localhost route running**

Start Next.js on port 3010 with the development-only font environment values.
Report:

- `http://localhost:3010/landing/v5`;
- focused unit-test result;
- typecheck and lint result;
- Playwright desktop/mobile result;
- production build and leak-scan result;
- the explicit note that the existing homepage remains unchanged.
