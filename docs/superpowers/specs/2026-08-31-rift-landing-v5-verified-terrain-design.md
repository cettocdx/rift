# RIFT Landing V5 — Verified Terrain Design Specification

Date: 2026-08-31  
Status: Visual direction approved; implementation planning pending  
Target route: `/landing/v5`  
Existing production landing: unchanged

## 1. Objective

Create a new RIFT landing page from a clean component boundary without altering
the current signed-out homepage or any existing landing route. V5 must make
RIFT feel like a category-defining professional agent for technical founders,
senior developers, and small high-agency product teams.

The page must make one argument:

> Give it the work. Get back proof.

RIFT is differentiated by execution and accountability, not by generic model
intelligence. A run receives a real machine, uses real tools, verifies the
result, and returns an inspectable trace and exact cost.

Primary conversion: `Start building`, routing to the existing browser product
entry flow. `Watch a real run` is the secondary action.

## 2. Approved creative direction

### 2.1 Visual world: Verified Terrain

Cursor's useful structural lesson is to place a technical product inside a
cultural and emotional visual world. RIFT will not copy Cursor's artwork or
brand composition. Its own world is `Verified Terrain`: every run is treated
as territory that has been explored, mapped, measured, and proven.

The approved hero base is the user-supplied 1500 × 500 cinematic landscape:

`/Users/cetto/Desktop/1500x500 (1).jpeg`

The asset shows layered mountain ridges, soft morning light, and dark grassland.
It becomes the primary image for V5, with the following restrained treatments:

- slow camera drift using transform only;
- low-amplitude fog and atmospheric depth;
- thin animated topographic contour lines;
- a dark lower scrim that protects headline and product contrast;
- subtle grain only if the source image needs it after final compression.

The page alternates among three grounds:

- cinematic terrain for the hero and one closing brand moment;
- warm off-white editorial paper for explanation and decision sections;
- near-black machine surfaces for run proof and product execution.

No purple AI gradients, decorative glass card grids, neon glows, or generic
abstract blobs are allowed.

### 2.2 Brand opening

`Recursive Intelligence for Technology` is the expansion of RIFT. In the hero
it appears as a cinematic identity line before settling behind the primary
product proposition. It must remain readable and must not permanently compete
with the H1.

Approved hero copy:

- Kicker: `Real machine · verified result`
- H1: `Give it the work. Get back proof.`
- Lede: `RIFT plans, executes and verifies the task on a real machine. Every run returns the finished result, full trace and exact cost.`
- Primary CTA: `Start building`
- Secondary CTA: `Watch a real run`

## 3. Typography

### 3.1 Local prototype

The user approved temporary localhost-only use of CursorGothic. CursorGothic is
a proprietary custom typeface derived from Kimera's Waldenburg and requires a
production web license.

V5 will isolate the temporary font behind a development-only loader:

- it may load only when `NODE_ENV !== "production"`;
- the production build must not contain a Cursor CDN URL or an unlicensed font
  binary;
- a test must fail if the temporary source can be emitted in production;
- the production release remains blocked until licensed files are supplied.

The type system is prepared for these licensed files:

- CursorGothic Regular, 400;
- CursorGothic Italic, 400;
- CursorGothic Bold, 700;
- CursorGothic Bold Italic, 700.

Most marketing text uses weight 400. Weight 700 is reserved for narrow utility
cases, never for large landing headlines.

### 3.2 Type hierarchy

- Hero: `clamp(48px, 6vw, 84px)`, weight 400, line-height 0.94–0.98,
  tracking approximately `-0.03em`.
- Section display: `clamp(36px, 4.4vw, 64px)`, weight 400, line-height
  0.98–1.04, tracking `-0.025em`.
- Card heading: 20–26px, weight 400, line-height 1.15.
- Body: 16–18px, line-height 1.45–1.6, maximum 65ch.
- Navigation and controls: 14px, weight 400.
- Machine labels and run data: existing licensed JetBrains Mono, 11–13px.

Fallback metrics will be specified to minimize layout shift. The fallback stack
is `Helvetica Neue, Helvetica, Arial, system-ui, sans-serif`.

## 4. Information architecture

The approved sequence is:

1. Navigation
2. Cinematic hero and live-looking verified run
3. Real run receipt
4. How a run earns “done”
5. Product surfaces: Build primary, Studio and Hack secondary
6. Draggable Connect field
7. Public run proof and authentic social proof
8. Trust and controls
9. Pricing
10. Final CTA and footer

The argument is `promise → evidence → mechanism → range → ecosystem → social
proof → decision`.

Long Studio, Hack, model-catalogue, optimization, and infrastructure
explanations move to their dedicated product routes. V5 may link to them but
will not reproduce the current long-form sections.

## 5. Section behavior

### 5.1 Navigation

- Transparent over the initial hero.
- Gains a high-opacity terrain-tinted surface, blur, and hairline after the
  actual scroll container moves.
- Desktop links: Product, Runs, Security, Pricing.
- Right side: Log in and Start building.
- Mobile: logo, Start building, and an accessible menu button.
- Includes a visible-on-focus skip link.
- All section anchors receive sufficient `scroll-margin-top`.

V5 must not repeat the current bug where a nested scroller moves while the nav
listens to `window.scrollY`. Either the page uses window scrolling or both nav
and sections receive the same explicit scroll-root reference.

### 5.2 Hero

- The landscape fills the visual field and remains the dominant emotional
  object.
- The RIFT expansion enters first with tracking and blur resolving gently.
- The H1 and CTAs settle from 16–22px lower with a short blur resolve.
- A compact near-black run panel appears in the lower-right on desktop.
- The panel contains believable task, verification, changed-line, tool,
  context, and cost data.
- On mobile, the panel becomes a readable full-width proof card beneath the
  copy; it is never a scaled-down desktop screenshot.
- The image has explicit dimensions, responsive sizes, and a strong focal
  crop for mobile.

### 5.3 Run receipt

This section appears directly after the hero. It uses real, inspectable RIFT
run data and does not require visitors to trust an abstract claim.

Initial verified example:

- 12 tools;
- +491 lines;
- 28/28 checks passed;
- 41K context;
- $2.10 total.

If these values are not backed by the existing run fixture, the implementation
must replace them with values from a verified fixture before publication.

### 5.4 How a run earns done

Four stages:

1. Scope
2. Execute
3. Verify
4. Return proof

Desktop may use a sticky visual stage, but the document scroll remains native.
No scroll-jacking, wheel interception, or hidden content is allowed. Mobile
uses a linear stack with the same information.

### 5.5 Product surfaces

Build receives roughly two-thirds of the visual weight. Studio and Hack are
smaller supporting scenes. All three use new V5 framing and composition, even
when they reuse trusted product data sources or runtime components.

- Build: task → execution → verified change.
- Studio: same context → generated media or model output.
- Hack: authorised scope → finding → retained evidence.

The whole desktop application will not be uniformly shrunk on mobile. Each
surface gets a mobile-specific crop, detail sequence, or composed proof card.

### 5.6 Connect field

The current draggable integration globe is retained as a signature interaction
but visually rebuilt for Verified Terrain.

- topographic orbit paths rather than a generic dotted sphere;
- center RIFT mark;
- integration marks scale, blur, and fade according to depth;
- direct pointer/touch drag;
- restrained momentum after release;
- keyboard-accessible alternate controls;
- no automatic rotation while the user is interacting;
- static, fully understandable reduced-motion fallback.

The implementation should prefer the existing lightweight canvas/DOM approach
over adding a new Three.js dependency to this route.

### 5.7 Social proof

The user requested visible people and user comments. Authenticity is a hard
requirement because RIFT's brand promise is proof.

For localhost concept review only:

- up to four synthetic adult personas may be generated;
- every card is visibly labelled `Synthetic preview`;
- generated names or quotes cannot be presented as real customers;
- concept cards are gated to development.

For production:

- publish only real users with approved name, role/company, portrait, and quote;
- if those assets are unavailable, replace the section with verified public run
  stories rather than fictional testimonials;
- no fake logos, metrics, names, companies, or quotations.

### 5.8 Trust, pricing, and close

Trust content is concise: isolation, explicit scope, retained trace, cost
visibility, and user-controlled credentials. Claims must correspond to shipped
product behavior.

Pricing retains the current Free, Pro, and Max values only if the live pricing
source confirms them at implementation time. Credits must be translated into
practical run examples. Included allowance and overage behavior must be stated
without contradiction.

The final section repeats the core proposition without introducing a new one:

> Put RIFT to work.

Primary CTA remains `Start building`.

## 6. Motion system

Motion communicates causality and system state. It is not added uniformly to
every section.

### Signature motions

1. **Cinematic terrain:** 12–18 second alternate camera drift, transform only.
2. **Identity resolve:** RIFT expansion resolves from slight blur and wider
   tracking, then quiets behind the primary hierarchy.
3. **Product settle:** run panel resolves over 700–1100ms using opacity,
   transform, and no more than 5px blur.
4. **Execution progress:** tool, file, test, and verification states advance
   from product state, not decorative timers.
5. **Connect physics:** pointer-driven rotation, spring release, depth-based
   integration treatment.
6. **Section entrances:** restrained 6–10px translation and opacity, triggered
   once.

### Motion constraints

- Use `motion/react`, already installed as `motion`.
- Animate transform and opacity by default.
- Avoid layout-property animation for continuous effects.
- Ambient motion pauses when off-screen or when the page is hidden.
- No `transition: all`.
- No scroll-jacking or forced horizontal scroll.
- `MotionConfig reducedMotion="user"` wraps the route.
- `prefers-reduced-motion` removes ambient loops and spring momentum while
  preserving all content and state.
- Touch interactions must not block vertical page scrolling unless a clear
  horizontal/drag gesture has been established.

## 7. Component architecture

New code lives under `app/components/landing-v5/` and does not modify
`landing-x`.

Proposed components:

- `V5Landing`
- `V5Nav`
- `V5Hero`
- `V5RunPanel`
- `V5RunReceipt`
- `V5RunMechanism`
- `V5ProductSurfaces`
- `V5ConnectField`
- `V5PublicRuns`
- `V5SocialProof`
- `V5Trust`
- `V5Pricing`
- `V5Close`
- `V5Footer`
- `V5Reveal`
- `v5-system.ts`
- `v5-content.ts`

The route `app/landing/v5/page.tsx` is a thin server component responsible for
metadata and the development-only font loader. The interactive landing tree is
client-side only where motion or pointer state requires it. Static sections
remain server-renderable whenever practical.

Shared content and run fixtures are typed and centralized. Components do not
embed duplicate marketing claims.

## 8. Data and failure behavior

- Start building and login use existing route helpers; no new auth behavior.
- Real run proof reuses verified fixtures or existing public landing data
  sources. The landing remains readable if live endpoints fail.
- If a live demo fails, show the last verified fixture with an explicit
  recorded-state label.
- If the hero image fails, the section falls back to a deliberate dark mineral
  color field with readable copy.
- If WebGL/canvas is unavailable, Connect displays the same integrations in a
  static topographic diagram.
- If the development font cannot load, fallback metrics preserve layout.

## 9. Accessibility

- Semantic header, nav, main, section, and footer landmarks.
- One H1 and sequential heading levels.
- Skip link.
- Visible keyboard focus on every control.
- Mobile menu has accessible name, expanded state, and focus management.
- Connect drag has buttons or keyboard instructions as an alternative.
- Decorative contours are hidden from assistive technology.
- Meaningful images have concise alt text; decorative media uses empty alt.
- Minimum 4.5:1 text contrast for body text.
- The layout survives 200% zoom without clipping essential content.
- Reduced-motion mode is tested independently.

## 10. Performance budgets

- No new Three.js bundle for V5.
- Hero landscape: AVIF/WebP derivatives with JPEG fallback; desktop target
  under 260KB and mobile target under 150KB when quality permits.
- Explicit image dimensions and responsive `sizes`.
- Below-fold media lazy loaded.
- Total production font payload under 200KB after licensing/subsetting.
- Avoid long-lived compositor layers outside visible animated scenes.
- Hero text must render without waiting for the custom font.
- Target LCP below 2.5 seconds on a representative production build and mobile
  connection profile.

## 11. Verification

### Unit and contract checks

- `/landing/v5` renders without changing `/` or `/landing/x`.
- primary CTA resolves to the intended Start building destination;
- one H1 and correct landmark structure;
- development font loader cannot be emitted in production;
- production social proof cannot contain synthetic concept fixtures;
- motion-reduced mode does not hide content;
- pricing copy matches the source of truth.

### Browser checks

- Desktop: 1440 × 900 and 1280 × 800.
- Mobile: 390 × 844 and 360 × 800.
- Keyboard-only navigation.
- 200% zoom.
- Reduced motion.
- Connect pointer and touch drag without page-scroll lock.
- Header background responds to the actual scroll root.
- No text or section headings pass visibly beneath a transparent header.
- No horizontal overflow.

### Quality review

- UI/UX review with `ui-ux-pro-max`.
- Frontend visual review with the selected high-end frontend skills.
- Motion implementation with the selected Framer Motion and motion-design
  skills.
- Independent animation review after implementation.
- React/Next.js performance review.
- Accessibility review against WCAG 2.2 AA expectations.

## 12. Non-goals

- Replacing the production homepage.
- Redesigning the signed-in product.
- Changing authentication, billing, or pricing logic.
- Publishing fictional testimonials.
- Shipping an unlicensed CursorGothic font.
- Reproducing Cursor's exact artwork, layouts, copy, logo, or interaction assets.
- Refactoring unrelated workbench code.

## 13. Acceptance criteria

V5 is ready for review when:

1. `/landing/v5` runs locally without altering the existing landing.
2. The approved landscape, RIFT expansion, headline, and CTAs form a coherent
   cinematic hero.
3. Real run evidence appears before broad feature marketing.
4. Build is clearly primary; Studio and Hack support the category.
5. Connect is draggable, performant, accessible, and visually integrated with
   Verified Terrain.
6. Mobile proof surfaces are readable rather than scaled desktop miniatures.
7. Development-only synthetic personas and temporary font sources cannot leak
   into production.
8. Responsive, accessibility, reduced-motion, test, typecheck, and targeted
   performance checks pass.
