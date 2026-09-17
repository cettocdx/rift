export interface BuiltInBuildQualityProfile {
  /** Stable catalog id used by the Build skill loader and marketplace. */
  id: "ui-ux-pro-max" | "design-taste-frontend";
  name: string;
  version: 2;
  instructions: readonly string[];
}

/**
 * The two Build quality profiles, exposed through the catalog as ordinary
 * opt-in skills. They are never embedded in the system prompt: applying them
 * is the user's choice, and a run that did not ask for them should not pay for
 * them. Frontend requests surface them as a name-only suggestion instead.
 */
export const MANDATORY_BUILD_SKILLS: readonly BuiltInBuildQualityProfile[] = [
  {
    id: "ui-ux-pro-max",
    name: "UI/UX professional quality profile",
    version: 2,
    instructions: [
      "Classify the product, audience, industry, content density, requested references, and implementation stack before choosing a visual direction.",
      "Before implementation, write a compact design read and define semantic color roles, type scale, spacing rhythm, radii, one icon family, layout grid, interaction states, and motion rules appropriate to the existing brand.",
      "Use established product and UX patterns appropriate to the task. Do not force landing-page patterns onto dashboards, editors, utilities, or games.",
      "Design the complete flow and its loading, empty, error, success, hover, active, focus-visible, disabled, and keyboard states. Every visible control must have a real behavior and an accessible name.",
      "Apply stack-specific implementation guidance and define explicit responsive behavior at roughly 375, 768, 1024, and 1440 pixels. Multi-column layouts must have a deliberate single-column mobile fallback and must never create horizontal page overflow.",
      "Meet WCAG AA contrast for text and controls, preserve semantic heading and landmark order, keep touch targets usable, provide visible keyboard focus, and never rely on color alone to communicate state.",
      "Respect prefers-reduced-motion, reserve media dimensions to prevent layout shift, and keep interaction feedback within 150-300ms without animating layout properties.",
      "Before delivery, run the relevant type, test, and production-build checks; inspect the rendered primary flow in light and dark themes where supported; check console errors, overflow, clipping, loading/error states, and keyboard navigation; repair failures before presenting the result.",
    ],
  },
  {
    id: "design-taste-frontend",
    name: "Authored frontend taste profile",
    version: 2,
    // Ported from Grok Build's design-ui playbook (printed verbatim by Grok on
    // 17 Aug 2026 — docs/product-transformation/grok-skills-dump-2026-08-17.md),
    // adapted to RIFT's stack. Their words where they transfer: this is "the
    // single biggest quality lever in the app builder".
    instructions: [
      "Design-system-first: define the system once, then compose from it — never sprinkle ad-hoc values. Put the palette, radii, and fonts in the main CSS as tokens (Tailwind v4 is CSS-first: declare them under @theme) and consume them as utilities. One source of truth.",
      "Ban ad-hoc styling: no raw hex in JSX, no text-white/bg-black literals, no arbitrary values like p-[16px] or text-[13px]. If you need a value, it becomes a token or a scale step.",
      "The quantified rubric that prevents ugly: at most 3-5 colors total (one primary + neutrals + at most one accent, used sparingly for primary actions — and never default to purple unless asked); at most 2 font families; body line-height 1.4-1.6, tighter for large headings; a consistent 4/8-based spacing scale with generous whitespace; when you override a background color, override the foreground too, and check contrast in both light and dark.",
      "Mobile-first: design the ~390px layout first, then scale up. No horizontal overflow; tap targets at least 44px.",
      'Anti-AI-slop, the tells that make output look generic: no gradient-blob filler or giant hero gradients standing in for content; no emoji as icons (use a real icon set — lucide-react); no hand-drawn SVG illustrations or charts (use a real chart library such as recharts, or real generated images); no placeholder images or lorem-gray boxes in the final product; no overused-font look. Every element earns its place — establish a system, then vary with intent, not randomness. Canvas that draws images needs crossOrigin="anonymous" on them, or the first read taints the canvas.',
      "Reach for shadcn/ui (Radix primitives with cva variants and tailwind-merge) for buttons, dialogs, dropdowns and inputs rather than hand-rolling them. They arrive accessible and consistent; style them through the tokens, never with inline hex.",
      "When the UI is an overlay on a game canvas, the canvas belongs to the game and this profile governs only the DOM layered over it — start screen, HUD, score, menus, pause, touch controls. Keep the overlay legible over whatever is rendering underneath (backdrop, contrast), and keep it out of the gameplay input path so it never swallows a pointer-lock click or a key the game owns.",
      "Tailwind v4 base fix: Preflight gives <button> cursor:default, which feels broken — add a base layer rule so non-disabled buttons and [role=button] get cursor:pointer.",
      "Clear visual hierarchy: one primary action per view; size, weight, and color express importance. Use real layout structure (grid/flex, container max-widths), never absolute-position hacks. Empty, loading, and error states are part of the design — do not ship blank or janky intermediate states.",
      "Motion is subtle and purposeful: short eased transitions (150-250ms) on hover/press/enter, transform and opacity only, respect prefers-reduced-motion, never animate layout in a way that janks.",
      "When editing an existing app, match its visual language — never introduce a second one.",
      "Finish checklist before calling UI done: tokens defined and no ad-hoc hex or arbitrary values in JSX; at most 5 colors and 2 fonts on a consistent spacing scale; contrast holds everywhere; ~390px has no overflow and targets are 44px+; real icons, images, and charts with none of the anti-slop tells; loading/empty/error handled; motion reduced-motion-safe; and the result RENDERED AND EYEBALLED in a browser, not just probed with curl.",
    ],
  },
] as const;

export type MandatoryBuildSkillId =
  (typeof MANDATORY_BUILD_SKILLS)[number]["id"];

export function isMandatoryBuildSkillId(
  value: string,
): value is MandatoryBuildSkillId {
  return MANDATORY_BUILD_SKILLS.some((skill) => skill.id === value);
}
