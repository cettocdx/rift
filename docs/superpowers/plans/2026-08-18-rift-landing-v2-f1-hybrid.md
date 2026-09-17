# RIFT Landing V2 F1 Hybrid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/landing/v2` as the approved F1 direction: A3's bold product narrative, B1's controlled multimodal density, and C2's cinematic RIFT Aperture moments.

**Architecture:** Keep the redesign isolated to `/landing/v2` because the current landing-v2 navigation, footer, sections, and token files are also consumed by marketing and landing-v3 routes. Reuse the existing scroll container and verified media assets, replace the 1,164-line interactive hero workspace with an optimized real product capture, and keep client JavaScript limited to the Aperture, reveal, navigation, and Studio selection leaves.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Tailwind CSS 4, Motion 12, `next/image`, Jest 30, Testing Library, Playwright 1.55.

## Global Constraints

- Limit implementation scope to `/landing/v2` and new `app/components/landing-v2/f1-*` modules; do not change Build, Studio, Hack, backend, model routing, or agent behavior.
- Preserve the existing `RiftLogo` as the primary logo; the Aperture is a display signature, not a replacement logo.
- Use `#080808`, `#101010`, `#282828`, `#F3F3EF`, `#A9A9A2`, and signal coral `#FF756A` exactly.
- Use Geist for headings and body; use JetBrains Mono only for model, status, command, data, and execution labels.
- Hero type is 48 px on 375 px screens, 56 px at `sm`, 72 px at `lg`, and 88 px at `xl`; section titles are 34, 40, 48, and 54 px at the same breakpoints.
- Use a 1240 px maximum content width, 96 px desktop section rhythm, and 56 to 64 px mobile section rhythm.
- Use pill radii for landing CTAs, 8 to 10 px for UI surfaces, and 12 to 16 px for media surfaces.
- Use `cubic-bezier(0.23, 1, 0.32, 1)`; Aperture duration is 900 ms, section reveals are 600 to 750 ms, and UI feedback is 150 to 220 ms.
- Under `prefers-reduced-motion`, use static Aperture geometry, opacity-only reveals, no parallax, and no autoplaying media.
- Do not add fake customers, testimonials, metrics, security claims, or pricing. Product claims must map to existing UI or repository behavior.
- Do not use long dash characters in visible marketing copy.
- Keep `/landing/v2` `noindex` until a separate promotion decision.
- Use Server Components by default and client components only where state, scroll observation, or motion requires them.
- Use `next/image` for raster images, include explicit dimensions and `sizes`, and prioritize only the hero product capture.
- Preserve all unrelated dirty-worktree changes. Stage and commit only the files listed in the active task.

---

## File Map

| File | Responsibility |
| --- | --- |
| `app/components/landing-v2/f1-design.ts` | F1 palette, typography, layout, and motion constants |
| `app/components/landing-v2/f1-content.ts` | Typed, product-backed public copy and asset metadata |
| `app/components/landing-v2/F1Reveal.tsx` | One reduced-motion-safe entrance primitive |
| `app/components/landing-v2/ApertureSignature.tsx` | Deterministic SVG display signature |
| `app/components/landing-v2/F1LandingNav.tsx` | F1 desktop and mobile navigation |
| `app/components/landing-v2/LandingHero.tsx` | New hero message, Aperture, CTAs, and product proof |
| `app/components/landing-v2/ProductProof.tsx` | Build, Studio, and Hack proof strip |
| `app/components/landing-v2/BuildNarrative.tsx` | Plan, execute, verify product story |
| `app/components/landing-v2/F1StudioShowcase.tsx` | User-controlled model and output showcase |
| `app/components/landing-v2/SystemContinuity.tsx` | Build, Studio, and Hack shared-context story |
| `app/components/landing-v2/EnterpriseProof.tsx` | Product-backed control and trust evidence |
| `app/components/landing-v2/F1PricingDownload.tsx` | Canonical pricing and download decision section |
| `app/components/landing-v2/F1LandingFooter.tsx` | Final CTA and verified route footer |
| `app/components/landing-v2/F1LandingSections.tsx` | Final F1 information architecture |
| `app/landing/v2/page.tsx` | Route metadata and F1 composition |
| `app/components/landing-v2/__tests__/f1-content.test.ts` | Token, copy, evidence, and asset contracts |
| `app/components/landing-v2/__tests__/ApertureSignature.test.tsx` | SVG determinism and accessibility contract |
| `app/components/landing-v2/__tests__/F1LandingExperience.test.tsx` | Hero, navigation, sections, Studio, and CTA behavior |
| `e2e/landing-v2.spec.ts` | Responsive, keyboard, motion, and overflow acceptance checks |

Existing `LandingNav`, `LandingFooter`, `LandingSections`, `MarketingPage`, `LandingComparison`, `HeroWorkspace`, `ProofStrip`, and legacy section components stay unchanged so current marketing and landing-v3 consumers are not altered.

---

### Task 1: Lock F1 tokens and product-backed content

**Files:**
- Create: `app/components/landing-v2/f1-design.ts`
- Create: `app/components/landing-v2/f1-content.ts`
- Create: `app/components/landing-v2/__tests__/f1-content.test.ts`

**Interfaces:**
- Produces: `F1_PALETTE`, `F1_CONTAINER_CLASS`, `F1_DISPLAY_CLASS`, `F1_SECTION_TITLE_CLASS`, `F1_LEAD_CLASS`, `F1_BODY_CLASS`, `F1_LABEL_CLASS`, `F1_SECTION_CLASS`, `F1_EASE_OUT`.
- Produces: `PRODUCT_SURFACES`, `BUILD_STEPS`, `STUDIO_OUTPUTS`, `CONTINUITY_STEPS`, `ENTERPRISE_CONTROLS`, `F1_NAV_LINKS`, and their exported TypeScript types.

- [ ] **Step 1: Write the failing content and design contract**

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  BUILD_STEPS,
  CONTINUITY_STEPS,
  ENTERPRISE_CONTROLS,
  PRODUCT_SURFACES,
  STUDIO_OUTPUTS,
} from "../f1-content";
import {
  F1_CONTAINER_CLASS,
  F1_DISPLAY_CLASS,
  F1_PALETTE,
  F1_SECTION_CLASS,
} from "../f1-design";

describe("F1 landing contracts", () => {
  it("pins the approved palette and layout", () => {
    expect(F1_PALETTE).toMatchObject({
      "--background": "#080808",
      "--foreground": "#F3F3EF",
      "--surface": "#101010",
      "--border": "#282828",
      "--muted-foreground": "#A9A9A2",
      "--primary": "#FF756A",
    });
    expect(F1_CONTAINER_CLASS).toContain("max-w-[1240px]");
    expect(F1_DISPLAY_CLASS).toContain("xl:text-[88px]");
    expect(F1_SECTION_CLASS).toContain("lg:py-24");
  });

  it("defines three product states and one three-step Build story", () => {
    expect(PRODUCT_SURFACES.map(({ id }) => id)).toEqual([
      "build",
      "studio",
      "hack",
    ]);
    expect(BUILD_STEPS.map(({ label }) => label)).toEqual([
      "Plan",
      "Execute",
      "Verify",
    ]);
    expect(CONTINUITY_STEPS).toHaveLength(3);
  });

  it("uses only local, existing public assets", () => {
    for (const item of [...PRODUCT_SURFACES, ...STUDIO_OUTPUTS]) {
      expect(item.imageSrc).toMatch(/^\//);
      expect(existsSync(join(process.cwd(), "public", item.imageSrc))).toBe(true);
      if ("videoSrc" in item && item.videoSrc) {
        expect(existsSync(join(process.cwd(), "public", item.videoSrc))).toBe(true);
      }
    }
  });

  it("keeps Studio metadata and descriptions verifiable", () => {
    expect(STUDIO_OUTPUTS.map(({ model }) => model)).toEqual([
      "Image model",
      "Image model",
      "Image model",
      "Video model",
    ]);
    expect(STUDIO_OUTPUTS.map(({ label }) => label)).toEqual([
      "Industrial object",
      "Desert architecture",
      "Color study",
      "Character continuity",
    ]);
    for (const item of STUDIO_OUTPUTS) {
      expect(item.imageAlt).toMatch(/^Reference media showing/);
    }
  });

  it("ships narrowly grounded enterprise controls", () => {
    expect(ENTERPRISE_CONTROLS.map(({ title }) => title)).toEqual([
      "Controlled execution",
      "Authorized operation launcher",
      "Credential boundaries",
    ]);
    expect(JSON.stringify([...BUILD_STEPS, ...ENTERPRISE_CONTROLS])).not.toMatch(
      /inside the same sandbox|testimonial|trusted by|customers/i,
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run: `pnpm exec jest app/components/landing-v2/__tests__/f1-content.test.ts --runInBand`

Expected: FAIL with `Cannot find module '../f1-content'` or `Cannot find module '../f1-design'`.

- [ ] **Step 3: Implement the F1 design constants**

Create `f1-design.ts` with:

```ts
import type { CSSProperties } from "react";

export const F1_PALETTE = {
  "--font-cursor-ui": "var(--font-geist), ui-sans-serif, system-ui, sans-serif",
  "--font-display": "var(--font-geist), ui-sans-serif, system-ui, sans-serif",
  "--font-sans": "var(--font-geist), ui-sans-serif, system-ui, sans-serif",
  "--font-mono":
    "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace",
  fontFamily: "var(--font-geist), ui-sans-serif, system-ui, sans-serif",
  "--background": "#080808",
  "--foreground": "#F3F3EF",
  "--surface": "#101010",
  "--border": "#282828",
  "--border-strong": "#3A3A3A",
  "--muted-foreground": "#A9A9A2",
  "--cursor-text-secondary": "#A9A9A2",
  "--primary": "#FF756A",
  "--signal-bright": "#FF756A",
  colorScheme: "dark",
} as CSSProperties;

export const F1_EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const F1_CONTAINER_CLASS =
  "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";
export const F1_DISPLAY_CLASS =
  "text-[48px] leading-[0.96] tracking-[-0.025em] font-medium sm:text-[56px] lg:text-[72px] xl:text-[88px]";
export const F1_SECTION_TITLE_CLASS =
  "text-[34px] leading-[1.06] tracking-[-0.025em] font-medium sm:text-[40px] lg:text-[48px] xl:text-[54px]";
export const F1_LEAD_CLASS =
  "text-[17px] leading-[1.5] tracking-[-0.006em] text-foreground/70 lg:text-[18px]";
export const F1_BODY_CLASS =
  "text-[16px] leading-[1.55] text-foreground/65";
export const F1_LABEL_CLASS =
  "font-mono text-[11px] leading-[1.45] uppercase tracking-[0.1em] text-foreground/50";
export const F1_SECTION_CLASS = "py-14 sm:py-16 lg:py-24";
```

- [ ] **Step 4: Implement the typed public content**

Create `f1-content.ts` with these exact exported records. Every claim is already represented by the existing product UI, `HeroWorkspace`, `HackWorkbenchSection`, or MCP credential implementation.

```ts
export type ProductSurfaceId = "build" | "studio" | "hack";

export type ProductSurface = {
  id: ProductSurfaceId;
  label: string;
  outcome: string;
  detail: string;
  imageSrc: string;
  imageAlt: string;
};

export const PRODUCT_SURFACES: readonly ProductSurface[] = [
  {
    id: "build",
    label: "Build",
    outcome: "A task becomes a verified change.",
    detail: "Plan, file edits, terminal output and verification stay in one run.",
    imageSrc: "/landing/product/build-product-design-4k.webp",
    imageAlt: "RIFT Build showing an agent task and its execution workspace.",
  },
  {
    id: "studio",
    label: "Studio",
    outcome: "A prompt becomes production media.",
    detail: "Image and video models share one composer and one output history.",
    imageSrc: "/landing/product/studio-4k.webp",
    imageAlt: "RIFT Studio showing available generation models and output controls.",
  },
  {
    id: "hack",
    label: "Hack",
    outcome: "A scoped assessment becomes evidence.",
    detail: "Authorized targets, tool output and verified findings stay connected.",
    imageSrc: "/landing/product/workbench-4k.webp",
    imageAlt: "RIFT Hack showing a scoped security assessment workspace.",
  },
] as const;

export const BUILD_STEPS = [
  {
    label: "Plan",
    title: "Turn intent into a concrete run.",
    body: "RIFT reads the workspace, defines the change and makes the execution path visible before the handoff.",
  },
  {
    label: "Execute",
    title: "Work inside the real environment.",
    body: "Files, packages and terminal commands stay attached to the environment the agent is using.",
  },
  {
    label: "Verify",
    title: "Return evidence, not confidence.",
    body: "Tests, type checks and the resulting diff remain attached to the run that produced them.",
  },
] as const;

export type StudioOutput = {
  id: string;
  label: string;
  model: string;
  modality: "Image" | "Video";
  imageSrc: string;
  imageAlt: string;
  videoSrc?: string;
};

export const STUDIO_OUTPUTS: readonly StudioOutput[] = [
  {
    id: "material",
    label: "Industrial object",
    model: "Image model",
    modality: "Image",
    imageSrc: "/studio/showcase-v3/image-flux-4k.webp",
    imageAlt: "Reference media showing a reflective chrome and translucent product form on dark stone.",
  },
  {
    id: "product",
    label: "Desert architecture",
    model: "Image model",
    modality: "Image",
    imageSrc: "/studio/showcase-v3/image-gemini-pro-4k.webp",
    imageAlt: "Reference media showing a modern sandstone building set against red desert cliffs.",
  },
  {
    id: "landscape",
    label: "Color study",
    model: "Image model",
    modality: "Image",
    imageSrc: "/studio/showcase-v3/image-lite-4k.webp",
    imageAlt: "Reference media showing a blank product surface surrounded by colorful translucent materials.",
  },
  {
    id: "motion",
    label: "Character continuity",
    model: "Video model",
    modality: "Video",
    imageSrc: "/studio/showcase-v3/video-kling-4k.webp",
    imageAlt: "Reference media showing a woman running across wet stone platforms in a cinematic environment.",
    videoSrc: "/studio/showcase-v3/video-kling-4k.mp4",
  },
] as const;

export const CONTINUITY_STEPS = [
  {
    id: "build",
    label: "01 / Build",
    title: "Start with the system.",
    body: "The repository, files and execution history establish the working context.",
  },
  {
    id: "studio",
    label: "02 / Studio",
    title: "Create inside that context.",
    body: "Media generation becomes part of the same project instead of a separate tab and export loop.",
  },
  {
    id: "hack",
    label: "03 / Hack",
    title: "Investigate without losing the thread.",
    body: "Authorized assessment evidence returns to the same body of work.",
  },
] as const;

export const ENTERPRISE_CONTROLS = [
  {
    title: "Controlled execution",
    body: "Cloud runs can use isolated sandboxes, while local mode stays explicit to the selected workspace.",
  },
  {
    title: "Authorized operation launcher",
    body: "Guided Hack operations collect the target, scope and authorization before launch.",
  },
  {
    title: "Credential boundaries",
    body: "Connected MCP OAuth credentials are stored and retrieved outside prompt copy.",
  },
] as const;

export const F1_NAV_LINKS = [
  { label: "Product", href: "#product" },
  { label: "Studio", href: "#studio" },
  { label: "Hack", href: "#system" },
  { label: "Enterprise", href: "#enterprise" },
  { label: "Pricing", href: "#pricing" },
] as const;
```

- [ ] **Step 5: Run the focused test**

Run: `pnpm exec jest app/components/landing-v2/__tests__/f1-content.test.ts --runInBand`

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit only Task 1 files**

```bash
git add app/components/landing-v2/f1-design.ts app/components/landing-v2/f1-content.ts app/components/landing-v2/__tests__/f1-content.test.ts
git commit -m "feat: define RIFT F1 landing system"
```

---

### Task 2: Build the motion primitives and Aperture signature

**Files:**
- Create: `app/components/landing-v2/F1Reveal.tsx`
- Create: `app/components/landing-v2/ApertureSignature.tsx`
- Create: `app/components/landing-v2/__tests__/ApertureSignature.test.tsx`

**Interfaces:**
- Consumes: `F1_EASE_OUT` from `f1-design.ts`.
- Produces: `F1Reveal({ children, delay?, className? })`.
- Produces: `ApertureSignature({ className?, compact? })` with an `aria-hidden` deterministic SVG.

- [ ] **Step 1: Write the failing Aperture contract**

```tsx
import { render } from "@testing-library/react";
import { ApertureSignature } from "../ApertureSignature";

describe("ApertureSignature", () => {
  it("renders deterministic decorative geometry", () => {
    const { container } = render(<ApertureSignature />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(container.querySelectorAll("line")).toHaveLength(48);
  });

  it("exposes the compact state without changing geometry", () => {
    const { container } = render(<ApertureSignature compact />);
    expect(container.firstChild).toHaveAttribute("data-compact", "true");
    expect(container.querySelectorAll("line")).toHaveLength(48);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec jest app/components/landing-v2/__tests__/ApertureSignature.test.tsx --runInBand`

Expected: FAIL with `Cannot find module '../ApertureSignature'`.

- [ ] **Step 3: Implement `F1Reveal`**

```tsx
"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { F1_EASE_OUT } from "./f1-design";

export function F1Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const revealClassName = [
    "motion-reduce:!transform-none",
    "motion-reduce:!opacity-100",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.div
      data-f1-reveal
      className={revealClassName}
      initial={{ opacity: 0, transform: "translateY(16px)" }}
      whileInView={{ opacity: 1, transform: "translateY(0px)" }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{
        duration: 0.65,
        delay,
        ease: F1_EASE_OUT,
      }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 4: Implement the 48-line Aperture**

```tsx
const roundToFourPlaces = (value: number) => Number(value.toFixed(4));

const SEGMENTS = Array.from({ length: 48 }, (_, index) => {
  const angle = (index / 48) * 360;
  const phase = Math.sin((index / 48) * Math.PI * 6);
  return {
    angle,
    inner: roundToFourPlaces(55 + phase * 5),
    outer: roundToFourPlaces(91 - phase * 7),
    opacity: roundToFourPlaces(0.35 + ((phase + 1) / 2) * 0.65),
  };
});

const APERTURE_MOTION_STYLES = `
  .f1-aperture-motion {
    animation: f1-aperture-enter 900ms cubic-bezier(0.23, 1, 0.32, 1) both;
    transform-origin: 120px 120px;
  }
  @keyframes f1-aperture-enter {
    from { opacity: 0; transform: rotate(-8deg); }
    to { opacity: 1; transform: rotate(0deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .f1-aperture-motion {
      animation: none;
      opacity: 1;
      transform: none;
    }
  }
`;

export function ApertureSignature({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      data-compact={compact ? "true" : "false"}
      className={className}
    >
      <svg
        viewBox="0 0 240 240"
        aria-hidden="true"
        focusable="false"
        className="size-full overflow-visible"
      >
        <style>{APERTURE_MOTION_STYLES}</style>
        <g className="f1-aperture-motion">
          {SEGMENTS.map((segment) => (
            <line
              key={segment.angle}
              x1="120"
              y1={120 - segment.inner}
              x2="120"
              y2={120 - segment.outer}
              stroke="currentColor"
              strokeWidth={compact ? 2.25 : 2.75}
              strokeLinecap="round"
              opacity={segment.opacity}
              transform={`rotate(${segment.angle} 120 120)`}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
```

- [ ] **Step 5: Run the focused test**

Run: `pnpm exec jest app/components/landing-v2/__tests__/ApertureSignature.test.tsx --runInBand`

Expected: PASS, 6 tests, including deterministic markup, hydration, reduced-motion, and single-group animation contracts.

- [ ] **Step 6: Commit only Task 2 files**

```bash
git add app/components/landing-v2/F1Reveal.tsx app/components/landing-v2/ApertureSignature.tsx app/components/landing-v2/__tests__/ApertureSignature.test.tsx
git commit -m "feat: add RIFT Aperture signature"
```

---

### Task 3: Replace the hero and add isolated F1 navigation

**Files:**
- Create: `app/components/landing-v2/F1LandingNav.tsx`
- Track existing dependency: `app/components/landing-v2/LandingShell.tsx`
- Modify: `app/components/landing-v2/LandingHero.tsx`
- Create: `app/components/landing-v2/__tests__/F1LandingExperience.test.tsx`

**Interfaces:**
- Consumes: `F1_NAV_LINKS`, F1 type and layout constants, `ApertureSignature`, `F1Reveal`.
- Produces: `F1LandingNav()` and the revised `LandingHero()`.
- `LandingHero` links `Download RIFT` to `/download` and `Watch RIFT work` to `#build`.

- [ ] **Step 1: Write failing hero and navigation tests**

Mock `next/image` as a normal image and render both components:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { F1LandingNav } from "../F1LandingNav";
import { LandingHero } from "../LandingHero";

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({
    priority: _priority,
    fill: _fill,
    ...props
  }: ComponentProps<"img"> & { priority?: boolean; fill?: boolean }) => (
    <img {...props} />
  ),
}));

describe("F1 landing chrome", () => {
  it("opens with the approved message and product proof", () => {
    render(<LandingHero />);
    expect(
      screen.getByRole("heading", { name: "Give RIFT the work." }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Download RIFT" })).toHaveAttribute(
      "href",
      "/download",
    );
    expect(
      screen.getByAltText("RIFT Build showing an agent task and its execution workspace."),
    ).toBeVisible();
  });

  it("exposes and closes the mobile navigation", () => {
    render(<F1LandingNav />);
    const toggle = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const mobileNav = screen.getByRole("navigation", { name: "Mobile" });
    expect(mobileNav).toBeVisible();
    fireEvent.click(within(mobileNav).getByRole("link", { name: "Studio" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: FAIL because `F1LandingNav` does not exist and the hero copy differs.

- [ ] **Step 3: Implement `F1LandingNav`**

Create the isolated component below. Do not alter `LandingNav.tsx`, which remains the navigation for `MarketingPage` and landing-v3.

```tsx
"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RiftLogo } from "@/components/icons/rift-logo";
import { F1_NAV_LINKS } from "./f1-content";
import { F1_CONTAINER_CLASS } from "./f1-design";
import { useLandingScrollContainer } from "./LandingShell";

export function F1LandingNav() {
  const [lifted, setLifted] = useState(false);
  const [open, setOpen] = useState(false);
  const scrollContainer = useLandingScrollContainer();

  useEffect(() => {
    const element = scrollContainer?.current;
    if (!element) return;
    const onScroll = () => setLifted(element.scrollTop > 80);
    onScroll();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [scrollContainer]);

  return (
    <header
      data-lifted={lifted ? "true" : "false"}
      className="fixed inset-x-0 top-0 z-50 border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-200 data-[lifted=true]:border-border data-[lifted=true]:bg-background/85 data-[lifted=true]:backdrop-blur-xl motion-reduce:transition-none"
    >
      <div className={`${F1_CONTAINER_CLASS} flex h-14 items-center gap-3 lg:h-16`}>
        <a href="#top" aria-label="RIFT home" className="flex min-h-11 items-center gap-2.5">
          <RiftLogo size={21} className="text-foreground" />
          <span className="text-[13px] font-medium tracking-[0.02em]">RIFT</span>
        </a>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 lg:flex">
          {F1_NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="inline-flex h-10 items-center rounded-full px-3 text-[13px] text-foreground/65 transition-colors duration-200 hover:bg-foreground/5 hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-4">
          <a href="/login" className="hidden h-10 items-center rounded-full px-3 text-[13px] text-foreground/70 transition-colors duration-200 hover:text-foreground sm:inline-flex">
            Sign in
          </a>
          <a href="/download" className="inline-flex h-10 items-center rounded-full bg-[var(--primary)] px-4 text-[13px] font-medium text-[#080808] transition-transform duration-200 active:translate-y-px">
            Download
          </a>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="f1-mobile-nav"
            aria-label={open ? "Close navigation" : "Open navigation"}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex size-11 items-center justify-center rounded-full border border-border text-foreground lg:hidden"
          >
            {open ? <X aria-hidden className="size-4" /> : <Menu aria-hidden className="size-4" />}
          </button>
        </div>
      </div>

      {open ? (
        <nav id="f1-mobile-nav" aria-label="Mobile" className="border-t border-border bg-background px-5 py-3 lg:hidden">
          <div className="mx-auto flex max-w-[1240px] flex-col">
            {F1_NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setOpen(false)} className="flex min-h-11 items-center border-b border-border text-[15px] text-foreground last:border-0">
                {link.label}
              </a>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
```

- [ ] **Step 4: Replace `LandingHero.tsx`**

Implement a Server Component with this fixed structure:

```tsx
import Image from "next/image";
import { ApertureSignature } from "./ApertureSignature";
import { F1Reveal } from "./F1Reveal";
import {
  F1_CONTAINER_CLASS,
  F1_DISPLAY_CLASS,
  F1_LEAD_CLASS,
} from "./f1-design";

export function LandingHero() {
  return (
    <section className="relative isolate overflow-hidden pt-28 sm:pt-32 lg:pt-40">
      <div className={`${F1_CONTAINER_CLASS} grid items-center gap-10 lg:grid-cols-12 lg:gap-8`}>
        <div className="lg:col-span-7">
          <F1Reveal>
            <h1 className={`max-w-[9ch] text-foreground ${F1_DISPLAY_CLASS}`}>
              Give RIFT the work.
            </h1>
          </F1Reveal>
          <F1Reveal delay={0.08}>
            <p className={`mt-6 max-w-[55ch] ${F1_LEAD_CLASS}`}>
              Build software, create media and investigate systems through the
              same agent layer.
            </p>
          </F1Reveal>
          <F1Reveal delay={0.14}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="/download" className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--primary)] px-6 text-[14px] font-medium text-[#080808] transition-transform duration-200 active:translate-y-px">
                Download RIFT
              </a>
              <a href="#build" className="inline-flex h-11 items-center justify-center rounded-full border border-border-strong px-6 text-[14px] font-medium text-foreground transition-colors duration-200 hover:bg-foreground/5">
                Watch RIFT work
              </a>
            </div>
          </F1Reveal>
        </div>
        <F1Reveal delay={0.1} className="lg:col-span-5">
          <ApertureSignature className="mx-auto w-full max-w-[430px] text-foreground" />
        </F1Reveal>
      </div>
      <F1Reveal delay={0.2} className={`${F1_CONTAINER_CLASS} mt-12 lg:mt-16`}>
        <div className="overflow-hidden rounded-[16px] border border-border bg-[var(--surface)] shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
          <Image
            src="/landing/product/build-product-design-4k.webp"
            alt="RIFT Build showing an agent task and its execution workspace."
            width={3840}
            height={2160}
            priority
            sizes="(max-width: 1280px) 100vw, 1240px"
            className="h-auto w-full"
          />
        </div>
      </F1Reveal>
    </section>
  );
}
```

- [ ] **Step 5: Run the focused test**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: PASS, 2 tests.

- [ ] **Step 6: Run focused lint**

Run: `pnpm exec eslint app/components/landing-v2/F1LandingNav.tsx app/components/landing-v2/LandingHero.tsx app/components/landing-v2/__tests__/F1LandingExperience.test.tsx`

Expected: exit 0 with no errors.

- [ ] **Step 7: Commit only Task 3 files**

```bash
git add app/components/landing-v2/F1LandingNav.tsx app/components/landing-v2/LandingHero.tsx app/components/landing-v2/__tests__/F1LandingExperience.test.tsx
git commit -m "feat: rebuild RIFT landing hero"
```

---

### Task 4: Build the product proof strip and Build narrative

**Files:**
- Create: `app/components/landing-v2/ProductProof.tsx`
- Create: `app/components/landing-v2/BuildNarrative.tsx`
- Modify: `app/components/landing-v2/__tests__/F1LandingExperience.test.tsx`

**Interfaces:**
- Consumes: `PRODUCT_SURFACES`, `BUILD_STEPS`, F1 constants, and `F1Reveal`.
- Produces: `ProductProof()` with `id="product"` and `BuildNarrative()` with `id="build"`.

- [ ] **Step 1: Add failing section tests**

Add imports and this test:

```tsx
import { BuildNarrative } from "../BuildNarrative";
import { ProductProof } from "../ProductProof";

it("proves all three surfaces and the Build execution sequence", () => {
  const { container } = render(
    <>
      <ProductProof />
      <BuildNarrative />
    </>,
  );
  expect(container.querySelector("#product")).toBeInTheDocument();
  expect(container.querySelector("#build")).toBeInTheDocument();
  for (const label of ["Build", "Studio", "Hack", "Plan", "Execute", "Verify"]) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
  expect(
    screen.getByRole("heading", { name: "From task to verified change." }),
  ).toBeVisible();
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: FAIL for missing `ProductProof` or `BuildNarrative`.

- [ ] **Step 3: Implement `ProductProof`**

Create the complete component below. It uses real captures and stacks without horizontal scrolling.

```tsx
import Image from "next/image";
import { F1Reveal } from "./F1Reveal";
import { PRODUCT_SURFACES } from "./f1-content";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_LABEL_CLASS,
} from "./f1-design";

export function ProductProof() {
  return (
    <section id="product" aria-labelledby="product-proof-title" className="border-y border-border py-14 sm:py-16">
      <div className={F1_CONTAINER_CLASS}>
        <F1Reveal>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="product-proof-title" className="max-w-[18ch] text-[24px] font-medium leading-[1.1] tracking-[-0.02em]">
              One workstation, three real surfaces.
            </h2>
            <p className={`${F1_BODY_CLASS} max-w-[46ch]`}>
              The work stays visible from the first instruction to the output that leaves the system.
            </p>
          </div>
        </F1Reveal>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {PRODUCT_SURFACES.map((surface, index) => (
            <F1Reveal key={surface.id} delay={index * 0.06}>
              <article className="overflow-hidden rounded-[14px] border border-border bg-[var(--surface)]">
                <div className="aspect-[16/10] overflow-hidden border-b border-border">
                  <Image src={surface.imageSrc} alt={surface.imageAlt} width={2400} height={1500} sizes="(max-width: 1024px) 100vw, 33vw" className="size-full object-cover" />
                </div>
                <div className="p-5">
                  <p className={F1_LABEL_CLASS}>{surface.label}</p>
                  <h3 className="mt-3 text-[18px] font-medium tracking-[-0.015em]">{surface.outcome}</h3>
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
```

- [ ] **Step 4: Implement `BuildNarrative`**

Create the split narrative below. It has no sticky scroll, scroll-jacking, scale entrance, or duplicated feature-card grid.

```tsx
import Image from "next/image";
import { F1Reveal } from "./F1Reveal";
import { BUILD_STEPS } from "./f1-content";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_LABEL_CLASS,
  F1_SECTION_CLASS,
  F1_SECTION_TITLE_CLASS,
} from "./f1-design";

export function BuildNarrative() {
  return (
    <section id="build" aria-labelledby="build-title" className={`${F1_CONTAINER_CLASS} ${F1_SECTION_CLASS} scroll-mt-20`}>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-5">
          <F1Reveal>
            <p className={F1_LABEL_CLASS}>Build</p>
            <h2 id="build-title" className={`mt-4 max-w-[13ch] ${F1_SECTION_TITLE_CLASS}`}>
              From task to verified change.
            </h2>
            <p className={`${F1_BODY_CLASS} mt-5 max-w-[52ch]`}>
              RIFT keeps the plan, execution and proof inside one legible run.
            </p>
          </F1Reveal>
          <ol className="mt-10 border-y border-border">
            {BUILD_STEPS.map((step, index) => (
              <li key={step.label} className="grid grid-cols-[72px_1fr] gap-4 border-b border-border py-6 last:border-b-0">
                <span className={F1_LABEL_CLASS}>{`0${index + 1} / ${step.label}`}</span>
                <div>
                  <h3 className="text-[17px] font-medium tracking-[-0.01em]">{step.title}</h3>
                  <p className={`${F1_BODY_CLASS} mt-2`}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <F1Reveal delay={0.08} className="lg:col-span-7 lg:self-center">
          <div className="overflow-hidden rounded-[16px] border border-border bg-[var(--surface)]">
            <Image src="/landing/product/build-product-design-4k.webp" alt="RIFT Build showing a plan, execution state and verification results." width={3840} height={2160} sizes="(max-width: 1024px) 100vw, 56vw" className="h-auto w-full" />
          </div>
        </F1Reveal>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run focused tests and lint**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: PASS.

Run: `pnpm exec eslint app/components/landing-v2/ProductProof.tsx app/components/landing-v2/BuildNarrative.tsx`

Expected: exit 0.

- [ ] **Step 6: Commit only Task 4 files**

```bash
git add app/components/landing-v2/ProductProof.tsx app/components/landing-v2/BuildNarrative.tsx app/components/landing-v2/__tests__/F1LandingExperience.test.tsx
git commit -m "feat: add product proof narrative"
```

---

### Task 5: Rebuild Studio as a controlled multimodal showcase

**Files:**
- Create: `app/components/landing-v2/F1StudioShowcase.tsx`
- Modify: `app/components/landing-v2/__tests__/F1LandingExperience.test.tsx`

**Interfaces:**
- Consumes: `STUDIO_OUTPUTS`, F1 type constants, `F1Reveal`.
- Produces: `F1StudioShowcase()` with `id="studio"`, a selected output state, a tablist, one large output, and three supporting previews.

- [ ] **Step 1: Add a failing Studio interaction test**

```tsx
import { F1StudioShowcase } from "../F1StudioShowcase";

it("keeps Studio media user controlled", () => {
  const { container } = render(<F1StudioShowcase />);
  expect(
    screen.getByRole("heading", {
      name: "The right model, inside the same workflow.",
    }),
  ).toBeVisible();
  expect(screen.getByRole("tablist", { name: "Studio outputs" })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: /Character continuity/ }));
  expect(screen.getByRole("tab", { name: /Character continuity/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(container.querySelector("video[controls]")).toBeInTheDocument();
  expect(container.querySelector("video[autoplay]")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify it fails against the legacy gallery**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: FAIL because there is no tablist and the legacy video autoplays.

- [ ] **Step 3: Create the isolated `F1StudioShowcase`**

Replace the legacy autoplay gallery with this user-controlled component:

```tsx
"use client";

import Image from "next/image";
import { useRef, useState, type KeyboardEvent } from "react";
import { F1Reveal } from "./F1Reveal";
import { STUDIO_OUTPUTS } from "./f1-content";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_LABEL_CLASS,
  F1_SECTION_CLASS,
  F1_SECTION_TITLE_CLASS,
} from "./f1-design";

export function F1StudioShowcase() {
  const [selectedId, setSelectedId] = useState(STUDIO_OUTPUTS[0].id);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected =
    STUDIO_OUTPUTS.find((item) => item.id === selectedId) ?? STUDIO_OUTPUTS[0];

  const selectFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = (index + direction + STUDIO_OUTPUTS.length) % STUDIO_OUTPUTS.length;
    setSelectedId(STUDIO_OUTPUTS[next].id);
    requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  return (
    <section id="studio" aria-labelledby="studio-title" className={`border-y border-border bg-[var(--surface)] ${F1_SECTION_CLASS} scroll-mt-20`}>
      <div className={F1_CONTAINER_CLASS}>
        <F1Reveal>
          <div className="grid gap-5 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <p className={F1_LABEL_CLASS}>Studio</p>
              <h2 id="studio-title" className={`mt-4 max-w-[15ch] ${F1_SECTION_TITLE_CLASS}`}>
                The right model, inside the same workflow.
              </h2>
            </div>
            <p className={`${F1_BODY_CLASS} max-w-[55ch] lg:col-span-5`}>
              Compare visual output by the work it produces, then keep the selected model attached to the project.
            </p>
          </div>
        </F1Reveal>

        <div className="mt-10 grid gap-5 lg:grid-cols-[1fr_340px]">
          <F1Reveal>
            <div id="studio-output-panel" role="tabpanel" className="overflow-hidden rounded-[16px] border border-border bg-background">
              <div className="aspect-[16/10] overflow-hidden">
                {selected.modality === "Video" && selected.videoSrc ? (
                  <video key={selected.videoSrc} controls muted playsInline preload="metadata" poster={selected.imageSrc} aria-label={selected.imageAlt} className="size-full object-cover">
                    <source src={selected.videoSrc} type="video/webm" />
                  </video>
                ) : (
                  <Image src={selected.imageSrc} alt={selected.imageAlt} width={1400} height={1046} sizes="(max-width: 1024px) 100vw, 70vw" className="size-full object-cover" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-5 py-4">
                <span className={F1_LABEL_CLASS}>{selected.modality}</span>
                <span className="text-[14px] font-medium">{selected.label}</span>
                <span className="ml-auto font-mono text-[12px] text-foreground/55">{selected.model}</span>
              </div>
            </div>
          </F1Reveal>

          <div role="tablist" aria-label="Studio outputs" className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            {STUDIO_OUTPUTS.map((item, index) => {
              const active = item.id === selected.id;
              return (
                <button
                  key={item.id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="studio-output-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => setSelectedId(item.id)}
                  onKeyDown={(event) => selectFromKeyboard(event, index)}
                  className="group min-h-11 overflow-hidden rounded-[12px] border border-border bg-background text-left transition-colors duration-200 hover:border-border-strong aria-selected:border-[var(--primary)]"
                >
                  <span className="grid grid-cols-[72px_1fr] items-center gap-3 p-2.5">
                    <span className="aspect-square overflow-hidden rounded-[8px]">
                      <Image src={item.imageSrc} alt="" width={160} height={160} sizes="72px" className="size-full object-cover" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{item.label}</span>
                      <span className="mt-1 block truncate font-mono text-[11px] text-foreground/50">{item.modality} / {item.model}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run focused tests and lint**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: PASS.

Run: `pnpm exec eslint app/components/landing-v2/F1StudioShowcase.tsx`

Expected: exit 0.

- [ ] **Step 5: Commit only Task 5 files**

```bash
git add app/components/landing-v2/F1StudioShowcase.tsx app/components/landing-v2/__tests__/F1LandingExperience.test.tsx
git commit -m "feat: rebuild Studio showcase"
```

---

### Task 6: Add the cinematic continuity story and factual enterprise layer

**Files:**
- Create: `app/components/landing-v2/SystemContinuity.tsx`
- Create: `app/components/landing-v2/EnterpriseProof.tsx`
- Modify: `app/components/landing-v2/__tests__/F1LandingExperience.test.tsx`

**Interfaces:**
- Consumes: `CONTINUITY_STEPS`, `ENTERPRISE_CONTROLS`, `ApertureSignature`, and F1 constants.
- Produces: `SystemContinuity()` with `id="system"` and `EnterpriseProof()` with `id="enterprise"`.

- [ ] **Step 1: Add failing continuity and evidence tests**

```tsx
import { EnterpriseProof } from "../EnterpriseProof";
import { SystemContinuity } from "../SystemContinuity";

it("presents one shared system and factual controls", () => {
  const { container } = render(
    <>
      <SystemContinuity />
      <EnterpriseProof />
    </>,
  );
  expect(container.querySelector("#system")).toBeInTheDocument();
  expect(container.querySelector("#enterprise")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "One context. Three working surfaces." }),
  ).toBeVisible();
  for (const title of [
    "Controlled execution",
    "Authorized operation launcher",
    "Credential boundaries",
  ]) {
    expect(screen.getByText(title)).toBeVisible();
  }
  expect(screen.queryByText(/trusted by/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: FAIL for the two missing components.

- [ ] **Step 3: Implement `SystemContinuity`**

Create the single C2 brand moment below. It contains no product screenshots and no looping animation.

```tsx
import { ApertureSignature } from "./ApertureSignature";
import { F1Reveal } from "./F1Reveal";
import { CONTINUITY_STEPS } from "./f1-content";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_LABEL_CLASS,
  F1_SECTION_CLASS,
  F1_SECTION_TITLE_CLASS,
} from "./f1-design";

export function SystemContinuity() {
  return (
    <section id="system" aria-labelledby="system-title" className={`relative isolate overflow-hidden ${F1_SECTION_CLASS} scroll-mt-20`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(255,255,255,0.055),transparent_34%)]" />
      <div className={`${F1_CONTAINER_CLASS} relative`}>
        <F1Reveal>
          <ApertureSignature compact className="mx-auto w-full max-w-[320px] text-foreground" />
          <h2 id="system-title" className={`mx-auto mt-8 max-w-[16ch] text-center ${F1_SECTION_TITLE_CLASS}`}>
            One context. Three working surfaces.
          </h2>
          <p className={`${F1_BODY_CLASS} mx-auto mt-5 max-w-[58ch] text-center`}>
            Work can change shape without losing the project, evidence or decisions that produced it.
          </p>
        </F1Reveal>

        <ol className="relative mt-12 grid gap-8 border-l border-border pl-6 md:grid-cols-3 md:gap-0 md:border-l-0 md:border-t md:pl-0 md:pt-8">
          {CONTINUITY_STEPS.map((step, index) => (
            <li key={step.id} className="relative md:px-6">
              <span aria-hidden className="absolute -left-[29px] top-1.5 size-2 rounded-full bg-[var(--primary)] md:-top-[37px] md:left-6" />
              <p className={F1_LABEL_CLASS}>{step.label}</p>
              <h3 className="mt-3 text-[18px] font-medium tracking-[-0.015em]">{step.title}</h3>
              <p className={`${F1_BODY_CLASS} mt-2`}>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Implement `EnterpriseProof`**

Create the product-backed evidence layer below. Do not add customer logos, anonymous quotes, badges, certification marks, percentages, or fabricated numerical evidence.

```tsx
import { F1Reveal } from "./F1Reveal";
import { ENTERPRISE_CONTROLS } from "./f1-content";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_LABEL_CLASS,
  F1_SECTION_CLASS,
  F1_SECTION_TITLE_CLASS,
} from "./f1-design";

export function EnterpriseProof() {
  return (
    <section id="enterprise" aria-labelledby="enterprise-title" className={`border-y border-border bg-[var(--surface)] ${F1_SECTION_CLASS} scroll-mt-20`}>
      <div className={F1_CONTAINER_CLASS}>
        <F1Reveal>
          <p className={F1_LABEL_CLASS}>Control</p>
          <h2 id="enterprise-title" className={`mt-4 max-w-[15ch] ${F1_SECTION_TITLE_CLASS}`}>
            Built for work that has to hold up.
          </h2>
        </F1Reveal>
        <div className="mt-10 border-y border-border">
          {ENTERPRISE_CONTROLS.map((item, index) => (
            <F1Reveal key={item.title} delay={index * 0.05}>
              <div className="grid gap-3 border-b border-border py-6 last:border-0 md:grid-cols-[1fr_1.4fr] md:gap-10">
                <h3 className="text-[17px] font-medium tracking-[-0.01em]">{item.title}</h3>
                <p className={F1_BODY_CLASS}>{item.body}</p>
              </div>
            </F1Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run focused tests and lint**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: PASS.

Run: `pnpm exec eslint app/components/landing-v2/SystemContinuity.tsx app/components/landing-v2/EnterpriseProof.tsx`

Expected: exit 0.

- [ ] **Step 6: Commit only Task 6 files**

```bash
git add app/components/landing-v2/SystemContinuity.tsx app/components/landing-v2/EnterpriseProof.tsx app/components/landing-v2/__tests__/F1LandingExperience.test.tsx
git commit -m "feat: connect RIFT product surfaces"
```

---

### Task 7: Add the purchase decision and final brand close

**Files:**
- Create: `app/components/landing-v2/F1PricingDownload.tsx`
- Create: `app/components/landing-v2/F1LandingFooter.tsx`
- Track existing dependency: `lib/pricing/plans.ts`
- Modify: `app/components/landing-v2/__tests__/F1LandingExperience.test.tsx`

**Interfaces:**
- Consumes: canonical `PLANS` from `@/lib/pricing/plans`, `RiftLogo`, and F1 constants.
- Produces: `F1PricingDownload()` with `id="pricing"` and `F1LandingFooter()` with final CTA `Put RIFT to work.`.

- [ ] **Step 1: Add failing pricing and footer tests**

```tsx
import { F1LandingFooter } from "../F1LandingFooter";
import { F1PricingDownload } from "../F1PricingDownload";

it("uses canonical plans and real route targets", () => {
  render(
    <>
      <F1PricingDownload />
      <F1LandingFooter />
    </>,
  );
  expect(screen.getByRole("heading", { name: "Choose how RIFT runs." })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Put RIFT to work." })).toBeVisible();
  expect(screen.getAllByRole("link", { name: "Download RIFT" })[0]).toHaveAttribute(
    "href",
    "/download",
  );
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
    "href",
    "/privacy-policy",
  );
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: FAIL for missing `F1PricingDownload` or `F1LandingFooter`.

- [ ] **Step 3: Implement `F1PricingDownload`**

Create the component below. Prices and checkout targets remain sourced from `PLANS`.

```tsx
import { PLANS } from "@/lib/pricing/plans";
import { F1Reveal } from "./F1Reveal";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_LABEL_CLASS,
  F1_SECTION_CLASS,
  F1_SECTION_TITLE_CLASS,
} from "./f1-design";

const PLATFORMS = ["macOS", "Windows", "Linux"] as const;

export function F1PricingDownload() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className={`${F1_CONTAINER_CLASS} ${F1_SECTION_CLASS} scroll-mt-20`}>
      <F1Reveal>
        <p className={F1_LABEL_CLASS}>Pricing and download</p>
        <h2 id="pricing-title" className={`mt-4 max-w-[14ch] ${F1_SECTION_TITLE_CLASS}`}>
          Choose how RIFT runs.
        </h2>
      </F1Reveal>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {PLANS.slice(0, 3).map((plan) => (
          <article key={plan.name} className={`flex rounded-[16px] border p-6 ${plan.highlight ? "border-[var(--primary)] bg-[var(--surface)]" : "border-border"}`}>
            <div className="flex w-full flex-col">
              <h3 className="text-[17px] font-medium">{plan.name}</h3>
              <p className="mt-4 flex items-baseline gap-2">
                <span className="text-[36px] font-medium tracking-[-0.025em]">{plan.price}</span>
                <span className="text-[13px] text-foreground/55">{plan.cadence}</span>
              </p>
              <p className={`${F1_BODY_CLASS} mt-3`}>{plan.blurb}</p>
              <ul className="mt-6 space-y-2 text-[14px] text-foreground/75">
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <a href={plan.href} className={`mt-8 inline-flex h-11 items-center justify-center rounded-full px-5 text-[14px] font-medium transition-colors duration-200 lg:mt-auto ${plan.highlight ? "bg-[var(--primary)] text-[#080808]" : "border border-border-strong text-foreground hover:bg-foreground/5"}`}>
                {plan.cta}
              </a>
            </div>
          </article>
        ))}
      </div>

      <F1Reveal delay={0.08}>
        <div className="mt-4 flex flex-col gap-6 rounded-[16px] border border-border bg-[var(--surface)] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-[20px] font-medium tracking-[-0.015em]">Desktop, when the work belongs on your machine.</h3>
            <p className={`${F1_BODY_CLASS} mt-2`}>{PLATFORMS.join(" / ")}</p>
          </div>
          <a href="/download" className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] px-6 text-[14px] font-medium text-[#080808]">
            Download RIFT
          </a>
        </div>
      </F1Reveal>
    </section>
  );
}
```

- [ ] **Step 4: Implement `F1LandingFooter`**

Create the complete footer below. It contains no non-existent social or company routes.

```tsx
import { RiftLogo } from "@/components/icons/rift-logo";
import { F1Reveal } from "./F1Reveal";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_SECTION_TITLE_CLASS,
} from "./f1-design";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "Product", href: "#product" },
      { label: "Studio", href: "#studio" },
      { label: "Shared system", href: "#system" },
      { label: "Enterprise", href: "#enterprise" },
    ],
  },
  {
    heading: "Get started",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Pricing", href: "/pricing" },
      { label: "Download", href: "/download" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms of Service", href: "/terms-of-service" },
      { label: "Refund Policy", href: "/refund-policy" },
    ],
  },
] as const;

export function F1LandingFooter() {
  return (
    <>
      <section className={`${F1_CONTAINER_CLASS} py-24 sm:py-32 lg:py-40`}>
        <F1Reveal>
          <div className="rounded-[16px] border border-border bg-[var(--surface)] px-6 py-16 text-center sm:px-12">
            <h2 className={`mx-auto max-w-[13ch] ${F1_SECTION_TITLE_CLASS}`}>Put RIFT to work.</h2>
            <p className={`${F1_BODY_CLASS} mx-auto mt-5 max-w-[52ch]`}>Bring the task, the files and the standard it has to meet.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <a href="/download" className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--primary)] px-6 text-[14px] font-medium text-[#080808]">Download RIFT</a>
              <a href="/login" className="inline-flex h-11 items-center justify-center rounded-full border border-border-strong px-6 text-[14px] font-medium">Sign in</a>
            </div>
          </div>
        </F1Reveal>
      </section>

      <footer className="border-t border-border">
        <div className={`${F1_CONTAINER_CLASS} py-14`}>
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
            <div>
              <div className="flex items-center gap-2.5"><RiftLogo size={22} /><span className="text-[13px] font-medium tracking-[0.02em]">RIFT</span></div>
              <p className={`${F1_BODY_CLASS} mt-4 max-w-[32ch]`}>The agent workstation for software, media and authorized systems work.</p>
            </div>
            {COLUMNS.map((column) => (
              <nav key={column.heading} aria-label={column.heading}>
                <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-foreground/50">{column.heading}</h2>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => <li key={link.href}><a href={link.href} className="text-[13px] text-foreground/70 transition-colors duration-200 hover:text-foreground">{link.label}</a></li>)}
                </ul>
              </nav>
            ))}
          </div>
          <div className="mt-14 flex flex-col gap-2 border-t border-border pt-6 text-[12px] text-foreground/50 sm:flex-row sm:justify-between">
            <p>© {new Date().getFullYear()} RIFT. All rights reserved.</p>
            <a href="mailto:hello@riftsys.app" className="hover:text-foreground">hello@riftsys.app</a>
          </div>
        </div>
      </footer>
    </>
  );
}
```

- [ ] **Step 5: Run focused tests and lint**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: PASS.

Run: `pnpm exec eslint app/components/landing-v2/F1PricingDownload.tsx app/components/landing-v2/F1LandingFooter.tsx`

Expected: exit 0.

- [ ] **Step 6: Commit only Task 7 files**

```bash
git add app/components/landing-v2/F1PricingDownload.tsx app/components/landing-v2/F1LandingFooter.tsx app/components/landing-v2/__tests__/F1LandingExperience.test.tsx
git commit -m "feat: complete RIFT landing conversion path"
```

---

### Task 8: Compose the final route and enforce the content contract

**Files:**
- Create: `app/components/landing-v2/F1LandingSections.tsx`
- Modify: `app/landing/v2/page.tsx`
- Modify: `app/components/landing-v2/__tests__/F1LandingExperience.test.tsx`

**Interfaces:**
- Consumes: all F1 section components and `F1_PALETTE`.
- Produces: final page order `Hero -> Product proof -> Build -> Studio -> System continuity -> Enterprise -> Pricing/download -> final CTA/footer`.

- [ ] **Step 1: Add a failing source-order and copy-safety contract**

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("composes the approved F1 order without legacy comparison or long dashes", () => {
  const page = readFileSync(join(process.cwd(), "app/landing/v2/page.tsx"), "utf8");
  const sections = readFileSync(
    join(process.cwd(), "app/components/landing-v2/F1LandingSections.tsx"),
    "utf8",
  );
  expect(page).toContain("<F1LandingNav />");
  expect(page).toContain("<LandingHero />");
  expect(page).toContain("<F1LandingSections />");
  expect(page).toContain("<F1LandingFooter />");
  expect(page).not.toContain("LandingComparison");

  const order = [
    "<ProductProof />",
    "<BuildNarrative />",
    "<F1StudioShowcase />",
    "<SystemContinuity />",
    "<EnterpriseProof />",
    "<F1PricingDownload />",
  ];
  for (let index = 1; index < order.length; index += 1) {
    expect(sections.indexOf(order[index - 1])).toBeLessThan(
      sections.indexOf(order[index]),
    );
  }
  expect(`${page}\n${sections}`).not.toMatch(/[—–]/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec jest app/components/landing-v2/__tests__/F1LandingExperience.test.tsx --runInBand`

Expected: FAIL because the route still imports legacy navigation, sections, comparison, and footer.

- [ ] **Step 3: Implement `F1LandingSections`**

```tsx
import { BuildNarrative } from "./BuildNarrative";
import { EnterpriseProof } from "./EnterpriseProof";
import { F1PricingDownload } from "./F1PricingDownload";
import { ProductProof } from "./ProductProof";
import { F1StudioShowcase } from "./F1StudioShowcase";
import { SystemContinuity } from "./SystemContinuity";

export function F1LandingSections() {
  return (
    <>
      <ProductProof />
      <BuildNarrative />
      <F1StudioShowcase />
      <SystemContinuity />
      <EnterpriseProof />
      <F1PricingDownload />
    </>
  );
}
```

- [ ] **Step 4: Replace the `/landing/v2` composition and metadata**

Replace the route with the complete isolated composition:

```tsx
import type { Metadata } from "next";
import { F1LandingFooter } from "@/app/components/landing-v2/F1LandingFooter";
import { F1LandingNav } from "@/app/components/landing-v2/F1LandingNav";
import { F1LandingSections } from "@/app/components/landing-v2/F1LandingSections";
import { LandingHero } from "@/app/components/landing-v2/LandingHero";
import { LandingShell } from "@/app/components/landing-v2/LandingShell";
import { F1_PALETTE } from "@/app/components/landing-v2/f1-design";

export const metadata: Metadata = {
  title: "RIFT | The agent workstation",
  description:
    "Build software, create media and investigate systems through the same agent layer.",
  robots: { index: false, follow: false },
};

export default function LandingV2Page() {
  return (
    <LandingShell
      style={F1_PALETTE}
      className="h-full overflow-y-auto bg-background font-sans text-foreground antialiased"
    >
      <noscript>
        <style>{`[data-landing-reveal],[data-f1-reveal]{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      <a
        href="#landing-v2-main"
        className="fixed left-4 top-3 z-[60] -translate-y-24 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      >
        Skip to content
      </a>
      <F1LandingNav />
      <main id="landing-v2-main" tabIndex={-1}>
        <LandingHero />
        <F1LandingSections />
      </main>
      <F1LandingFooter />
    </LandingShell>
  );
}
```

- [ ] **Step 5: Run all landing-v2 unit tests**

Run: `pnpm exec jest app/components/landing-v2/__tests__ --runInBand`

Expected: PASS for `type-scale-contract`, `f1-content`, `ApertureSignature`, and `F1LandingExperience`.

- [ ] **Step 6: Run focused lint and typecheck**

Run: `pnpm exec eslint app/landing/v2/page.tsx app/components/landing-v2/F1*.tsx app/components/landing-v2/LandingHero.tsx app/components/landing-v2/ProductProof.tsx app/components/landing-v2/BuildNarrative.tsx app/components/landing-v2/SystemContinuity.tsx app/components/landing-v2/EnterpriseProof.tsx app/components/landing-v2/f1-*.ts`

Expected: exit 0.

Run: `pnpm typecheck`

Expected: exit 0. If unrelated pre-existing failures occur, record their exact file and error separately and confirm no failure points to Task 1 through Task 8 files.

- [ ] **Step 7: Commit only Task 8 files**

```bash
git add app/components/landing-v2/F1LandingSections.tsx app/landing/v2/page.tsx app/components/landing-v2/__tests__/F1LandingExperience.test.tsx
git commit -m "feat: compose RIFT F1 landing experience"
```

---

### Task 9: Verify responsive, accessibility, and motion behavior in a real browser

**Files:**
- Create: `e2e/landing-v2.spec.ts`

**Interfaces:**
- Consumes: the completed `/landing/v2` route.
- Produces: browser-level acceptance coverage for navigation, anchors, overflow, focus, reduced motion, and screenshots.

- [ ] **Step 1: Write the Playwright acceptance spec**

```ts
import { expect, test } from "@playwright/test";

const widths = [375, 768, 1024, 1440] as const;

for (const width of widths) {
  test(`landing v2 fits ${width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/landing/v2");
    await expect(page.getByRole("heading", { name: "Give RIFT the work." })).toBeVisible();
    const overflow = await page.locator("#top").evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.locator("#top").evaluate((element) => {
      element.style.height = "auto";
      element.style.overflow = "visible";
    });
    await page.screenshot({
      path: `test-results/landing-v2-${width}.png`,
      fullPage: true,
    });
  });
}

test("landing v2 supports keyboard navigation", async ({ page }) => {
  await page.goto("/landing/v2");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#landing-v2-main")).toBeFocused();
  await page.locator("#studio").scrollIntoViewIfNeeded();
  const firstTab = page.getByRole("tab").first();
  await firstTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab").nth(1)).toBeFocused();
});

test("landing v2 honors reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/landing/v2");
  await expect(page.getByRole("heading", { name: "Give RIFT the work." })).toBeVisible();
  const autoplayCount = await page.locator("video[autoplay]").count();
  expect(autoplayCount).toBe(0);
  await context.close();
});
```

- [ ] **Step 2: Run Chromium against the already running local server**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3060 pnpm exec playwright test e2e/landing-v2.spec.ts --project=chromium --no-deps`

Expected: 6 tests pass and four screenshots are written under `test-results/`.

- [ ] **Step 3: Inspect all four screenshots**

Check each generated screenshot for:

- hero heading, CTAs, Aperture, and the beginning of the product surface within the first 900 px;
- no cropped CTA labels or media;
- no repeated eyebrow and card-grid rhythm;
- one dominant visual object per viewport;
- readable Studio controls and continuity sequence;
- no broken image, false logo wall, or empty enterprise block.

Also set Chrome page zoom to 200 percent at 1440 px and repeat the horizontal-overflow, focus visibility, CTA wrapping, and Studio tab checks.

If a defect is found, add a failing unit or browser assertion before adjusting the owning component, then rerun Step 2.

- [ ] **Step 4: Run full landing verification**

Run: `pnpm exec jest app/components/landing-v2/__tests__ --runInBand`

Expected: PASS.

Run: `pnpm exec eslint app/landing/v2/page.tsx app/components/landing-v2/F1*.tsx app/components/landing-v2/LandingHero.tsx app/components/landing-v2/ProductProof.tsx app/components/landing-v2/BuildNarrative.tsx app/components/landing-v2/SystemContinuity.tsx app/components/landing-v2/EnterpriseProof.tsx app/components/landing-v2/f1-*.ts e2e/landing-v2.spec.ts`

Expected: exit 0.

Run: `pnpm typecheck`

Expected: exit 0 or only separately documented pre-existing errors outside the changed file list.

- [ ] **Step 5: Commit the acceptance test**

```bash
git add e2e/landing-v2.spec.ts
git commit -m "test: cover RIFT F1 landing experience"
```

---

### Task 10: Final scope and release audit

**Files:**
- Verify only; no planned source edits.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a verified `/landing/v2` candidate that remains `noindex` and does not alter other landing routes.

- [ ] **Step 1: Confirm the route remains isolated**

Run: `git diff 48cfd4b..HEAD --name-only | sort`

Expected: only the Task 1 through Task 9 file map plus this plan/spec history. There must be no Build, Studio, Hack product-runtime, backend, pricing-source, or landing-v3 file.

- [ ] **Step 2: Confirm no legacy F1 consumers changed**

Run: `git diff 48cfd4b..HEAD -- app/components/landing-v2/LandingNav.tsx app/components/landing-v2/LandingFooter.tsx app/components/landing-v2/LandingSections.tsx app/components/landing-v2/StudioShowcase.tsx app/components/landing-v2/MarketingPage.tsx app/components/landing-v3/QuietLanding.tsx`

Expected: no output.

- [ ] **Step 3: Scan visible F1 source for prohibited content patterns**

Run: `rg -n '—|–|trusted by|testimonial|industry-leading|best-in-class|100%|fortune 500' app/landing/v2/page.tsx app/components/landing-v2/{F1*,LandingHero,ProductProof,BuildNarrative,SystemContinuity,EnterpriseProof,f1-*}.{ts,tsx}`

Expected: no matches.

- [ ] **Step 4: Confirm route metadata and product asset responses**

Run: `curl -fsS http://localhost:3060/landing/v2 | rg -n 'noindex|Give RIFT the work|same agent layer'`

Expected: all three strings are present in the rendered HTML.

Run: `for asset in landing/product/build-product-design-4k.webp landing/product/studio-4k.webp landing/product/workbench-4k.webp studio/showcase-v3/image-flux-4k.webp studio/showcase-v3/image-gemini-pro-4k.webp studio/showcase-v3/image-lite-4k.webp studio/showcase-v3/video-kling-4k.webp studio/showcase-v3/video-kling-4k.mp4; do curl -fsSI "http://localhost:3060/$asset" | head -n 1; done`

Expected: every response line contains `200`.

- [ ] **Step 5: Measure the lab performance budget**

Run: `pnpm dlx lighthouse http://localhost:3060/landing/v2 --only-categories=performance,accessibility --chrome-flags="--headless --no-sandbox" --output=json --output-path=/tmp/rift-landing-v2-lighthouse.json`

Expected: command exits 0 and writes `/tmp/rift-landing-v2-lighthouse.json` without modifying the repository.

Run: `node -e 'const r=require("/tmp/rift-landing-v2-lighthouse.json"); const a=r.audits; const m={lcp:a["largest-contentful-paint"].numericValue,cls:a["cumulative-layout-shift"].numericValue,tbt:a["total-blocking-time"].numericValue}; console.log(m); if(m.lcp>=2500||m.cls>=0.1||m.tbt>=200) process.exit(1)'`

Expected: exit 0 with LCP below 2500 ms, CLS below 0.1, and total blocking time below 200 ms as the lab interaction proxy. INP must be watched through production field data only after a separate promotion decision because Lighthouse cannot create field INP for a noindex development route.

- [ ] **Step 6: Review commits without touching unrelated work**

Run: `git log --oneline --max-count=10`

Expected: the F1 commits appear as small, task-scoped commits. Do not squash, rebase, merge, promote `/landing/v2`, or change `robots` without a separate user instruction.
