# Axiom landing page forensics — 2026-08-14

Primary-source teardown of `https://axiom.co/` for RIFT's landing page work
(`app/landing/v2/page.tsx`, `app/components/landing-v2/*`). Every claim below is
either a value I measured in the live page or a quotation from the served
bundle. No third-party write-ups were used.

## Evidence method

- Live page loaded in an isolated Chrome tab at viewport **1512 × 753**, dark
  theme (the site ships `class="… dark"` on `<html>` and has no light mode).
- DOM facts via `getComputedStyle` / `getBoundingClientRect` / `document.styleSheets`.
- Behaviour facts via `fetch()` of the served chunks, then regex over the
  minified source. The main app chunk is
  `https://axiom.co/_next/static/chunks/3q_lqofm6ckob.js` (1,514,156 chars
  decoded, 437 KB on the wire). Quoted code below is **minified source read
  verbatim from that file**; identifiers are the minifier's.
- Timings via `PerformanceResourceTiming` / `PerformanceNavigationTiming`.

### What I could not verify

- **Anything requiring a running rAF loop.** The automation tab stayed
  `document.hidden === true` the whole session, so `requestAnimationFrame` never
  fired (measured: 0 rAF callbacks over 30 s). I therefore could **not** watch
  the hero demo play, the bell-slider spring settle, or the 2D-canvas chart draw.
  All motion timings below come from the source constants, not from stopwatching
  pixels. Where a claim rests only on source, it says so.
- **`prefers-reduced-motion: reduce` behaviour was not exercised**, only read
  from source. I had no CDP emulation available.
- FCP measured 2192 ms and total transfer 1706 KB, but these were captured under
  automation in a backgrounded tab and should not be treated as field numbers.
- Canvas #1 (the "Visibility shrinks as you grow" card chart) never initialised
  during my session — see §1.4.

---

## 0. Stack, at a glance

| Fact | Value | Source |
| --- | --- | --- |
| Framework | Next.js App Router, Turbopack build | `/_next/static/chunks/turbopack-*.js`; `window.__next_f` present |
| CSS | Tailwind v4 (`bg-linear-to-t`, `size-*`, `mask-[...]`, `@theme` custom props) | class strings in DOM |
| Motion | `motion` v12 (`motion/react`, the framer-motion successor) | `motionValue`/`AnimatePresence`/`useInView` in chunk; **zero** gsap / anime.js / react-spring / three.js / lottie matches |
| Numbers | `number-flow` (`<number-flow-react>` custom element, shadow DOM) | 2 elements in DOM; `--_number-flow-dx` in chunk |
| Icons | `lucide-react` | `lucide-${name}` class generator in chunk |
| Charting | **none** — no recharts / d3 / visx / echarts | grep of all 14 chunks |
| Pricing engine | **WebAssembly**, `calculator.wasm`, 641 KB wire / 1948 KB decoded, `fetch`ed at t≈2439 ms (after first paint) | `PerformanceResourceTiming`; `"Failed to initialize the pricing runtime."` in chunk |
| Images | **zero `<img>` elements**, zero `url()` backgrounds. 180 inline `<svg>`, 26 CSS gradients, 3 `<canvas>` | `document.querySelectorAll` |
| DOM size | 3891 nodes, max depth 22 | measured |
| HTML | 1263 KB decoded / **170 KB Brotli**; 653 KB of it is inline RSC flight payload | `PerformanceNavigationTiming` |
| Page height | 11,126 px, 11 `<section>` elements | measured |

RIFT already has `motion@^12.40.0`, Next 16, React 19, Tailwind 4 — the same
toolchain. Everything in §7 is directly portable.

---

## 1. Hero product demo

### 1.1 What it is

**Real DOM. Not canvas, not video, not images.** Server-rendered in the initial
HTML (the string `Dataset library` appears at byte 236,144 of the document, and
`type="range"` appears once — the page is fully SSR'd, not client-mounted).

Measured structure:

```
section (hero)
└ div.relative.w-full [1208×720]
  ├ canvas.pointer-events-none.hidden.lg:block.absolute.top-[-60%].left-[40%]   ← WebGL glow, §4
  └ div.contents  aria-hidden="true"                                             ← the whole replica
    └ div.relative.cursor-default.select-none.[&_button]:cursor-pointer.[&_button]:outline-none
                 .xl:w-auto.xl:me-[calc(50%-50vw)].2xl:-mx-12                    [1366×720]
      └ div.relative.w-full.min-w-290                                            [1366×720]
        ├ div.h-180.rounded-[14px].border.border-primary/3.p-1.5                 [1366×720]
        │ └ div.flex.h-full.flex-col.overflow-hidden.rounded-[11px]
        │        .border.border-gray-3.bg-gray-1.text-gray-12                    [1352×706]
        ├ div.pointer-events-none.absolute.inset-x-0.bottom-0.h-2/4
        │        .bg-linear-to-t.from-background.to-transparent                  [1366×360]
        ├ div.pointer-events-none.absolute.inset-y-0.right-0.w-2/4
        │        .bg-linear-to-l.from-background.to-transparent                  [683×720]
        └ div.absolute.-bottom-16.right-12.z-30 (floating agent terminal)        [520×460]
```

Three composition tricks worth stealing, all measured:

1. **Overflow past the container on purpose.** `min-w-290` = 1160 px minimum and
   `xl:me-[calc(50%-50vw)]` pulls the right edge out to the viewport edge. The
   mock renders 1366 px wide inside a 1240 px `.section` container, so it reads
   as "a real app that doesn't fit", not "a screenshot".
2. **Two gradient fades instead of a crop.** A bottom 50 % `to-t` fade and a
   right 50 % `to-l` fade, both `from-background`, both `pointer-events-none`.
   The app dissolves into the page rather than ending at a hard edge.
3. **Double border with 6 px inset.** `rounded-[14px] border-primary/3 p-1.5`
   wrapping `rounded-[11px] border-gray-3` — a 6 px "bezel". Radius delta is
   exactly the padding (14 − 1.5·4 ≈ 11), so the corners stay concentric.

### 1.2 What is actually interactive, and what drives the chart

Genuinely interactive — I verified by clicking. The component is exported as
`AxiomDashboard` and holds `useState("query")`; the five tabs swap **entirely
different view trees**, not just a highlight:

| Tab clicked | Text after click (measured) |
| --- | --- |
| Stream | `Stream / api-gateway-prod  Live  └ Any status  Any method  Any service  Reset filters  _time  Event …` |
| Dashboards | provider/model/capability filter row + 4 NumberFlow stat cards (`13,516`, `77,282`, `377`, `32.39 ms`) + a 9-column "Vitals" table |
| Monitors | `ERR Elevated error rate on prod … Edit monitor  Disable monitor … Recent activity  Last 3 hours` |
| Datasets | `…production-logs 14.2B Events · 1.8 TB  Open in Stream  Open in Query  Name Events Data Fields Created at Last ingest …` |
| Query | the APL editor with `['payment-service'] \| where ['event.type'] == "charge.failed" \| summarize count()…` |

**Nothing in the demo fetches.** All data is literal in the bundle
(`payment-service` ×13, `api-gateway-prod` ×6, `incident-2317` ×3, `charge.failed`
×1 — all in `3q_lqofm6ckob.js`). The strings that look like endpoints
(`/api/v1/orders`, `/api/v1/checkout`, `/api/v1/payments`) are fake log rows. The
only non-asset network calls on the page are
`status.axiom.co/api/v2/summary.json`, the pricing WASM, and analytics
(GA/LinkedIn/PostHog/dub).

**The charts are DOM, not canvas and not SVG.** Inside the 567-element hero mock
there are **0 `<canvas>`** and **0 SVG larger than 100 px** — every histogram is a
row of `<span>`s. From source:

```js
// hero query-results histogram
{hidden:{}, visible:{transition:{staggerChildren:.008}}}
{hidden:{scaleY:0}, visible:{scaleY:1, transition:{duration:.3, ease:"easeOut"}}}
```

Bars grow with `scaleY` (a compositor property), staggered **8 ms** apart. Other
instances use `staggerChildren: .004` and `.012`. Nothing animates `height`.

### 1.3 Motion: exact constants

The whole demo is gated on one in-view check and **never replays**:

```js
// AxiomDashboard
let d = useInView(c, {amount:.25, once:!0}),
    p = useInView(m, {amount:.25, once:!0})
```

That `once:!0` (`once: true`) pattern is universal — I found **27** `once:!0`
sites and **zero** repeating in-view triggers. Typical thresholds: `amount: 0.3`
(most demos), `0.25` (hero), `0.2` (code blocks), `0.4`, `1`.

Empirical confirmation: I sampled the hero mock's `innerText` every 400 ms for
30 s. Length stayed at 1385 chars, tab selection stayed `Query`. **No autoplay
loop, no cycling.** It plays once, then sits still until you click it.

Complete motion vocabulary extracted from app code (offset > 440 k in the chunk):

**Durations** — `.3s ×20`, `.2s ×9`, `.5s ×8`, `.15s ×8`, `.35s ×7`, `.7s ×6`,
`.25s ×5`, `1s ×5`, `.4s ×3`, `.18s ×3`, `.22s ×2`, `.55s ×2`, `.6s ×1`, `.8s ×1`.

**Easings** — `"easeOut" ×34`, `"easeInOut" ×18`, `"linear" ×12`,
`[.16,1,.3,1] ×2` (easeOutExpo), `"easeIn" ×2`, `[.455,.03,.515,.955] ×1`.

**Springs — exactly one on the entire page**: `{stiffness:400, damping:40}`, used
only by the pricing slider (§2). Damping ratio = 40 / (2·√400) = **1.0**, i.e.
critically damped, zero overshoot. There is **no `type:"spring"` transition
anywhere**. Everything else is a tween.

**Travel distances are tiny.** The complete inventory of translate offsets inside
the demos:

```js
{hidden:{opacity:0,y:0},  visible:{opacity:1,y:0, transition:{duration:.35, ease:"easeInOut"}}}
{hidden:{opacity:0,y:4},  visible:{opacity:1,y:0, transition:{duration:.3,  ease:"easeOut"}}}
{hidden:{opacity:0,y:4},  visible:{opacity:1,y:0, transition:{duration:.25, ease:"easeOut"}}}
{hidden:{opacity:0,y:6},  visible:{opacity:1,y:0, transition:{duration:.3,  ease:"easeOut"}}}
{hidden:{opacity:0,x:-6}, visible:{opacity:1,x:0, transition:{duration:.3,  ease:"easeOut"}}}
{hidden:{opacity:0,x:6},  visible:{opacity:1,x:0, transition:{duration:.3,  ease:"easeOut"}}}
{hidden:{scaleX:0},       visible:{scaleX:1,      transition:{duration:.5,  ease:"easeOut"}}}
{hidden:{scaleY:0},       visible:{scaleY:1,      transition:{duration:.3,  ease:"easeOut"}}}
```

**Maximum translate anywhere in the product demos is 6 px.** The only larger
travel on the page is `translate-y-8` (32 px) on the scroll-quote attribution
(§3). Parent stagger containers: `staggerChildren` ∈ {.004, .008, .012, .025,
.04, .045, .05, .06, .08, .12}, `delayChildren` ∈ {.08, .1, .15, .2}.

**The "typing" in the query editor is not typing.** From the `Code` component:

```js
let s = {txt:"text-gray-12", kw:"text-blue-11", str:"text-orange-11",
         num:"text-yellow-11", fn:"text-[#3ed68c]", fnm:"text-[#f5e147]", grn:"text-[#3dd68c]"},
    o = {hidden:  {opacity:0},
         visible: e => ({opacity:1, transition:{delay:.035*e, duration:.18, ease:"easeOut"}}),
         clearing:{opacity:0, transition:{duration:.2, ease:"easeInOut"}}}
```

Lines are split on whitespace into word tokens, each token gets a global index,
and each fades in at `delay = 0.035 × index` over 180 ms. Total run length is
computed up front:

```js
j = useMemo(() => (w.reduce((e,t) => e + 1 + t.words.length, 0) - 1) * .035 + .18 + .05, [w])
```

Then a caret appears and blinks forever, on **opacity only**:

```js
{"aria-hidden":!0, animate:{opacity:[1,1,0,0]},
 transition:{duration:1, repeat:1/0, times:[0,.5,.5,1], ease:"linear"}}
```

Syntax colours are the same Radix tokens as the rest of the page (`blue-11`,
`orange-11`, `yellow-11`), not a separate editor theme.

### 1.4 Accessibility: they got the inside right and the outside wrong

Inside the mock, the semantics are correct:

- `<div role="tablist">` with five `<button role="tab" aria-selected="true|false">`
  (and a second tablist for Builder/Editor).
- The Axiom logo carries `role="img" aria-label="Axiom"`.
- Every decorative icon is `aria-hidden="true"` (dozens of them).

But the **entire replica sits inside `<div class="contents" aria-hidden="true">`**
(I walked the ancestor chain; that is the only `aria-hidden` ancestor). And
`aria-hidden` does not remove anything from the tab order.

Measured consequence on the live page:

- 147 focusable elements total.
- **73 of them (~50 %) are inside `aria-hidden="true"` subtrees.**
- Zero `tabindex="-1"`, zero `inert` anywhere in the mock.
- The wrapper sets `[&_button]:outline-none`, and I confirmed with `.focus()`
  that a focused demo button computes `outline-style: none`, `box-shadow: none`.

So a keyboard user tabs through ~73 invisible stops that screen readers refuse
to announce. This is a bug, not a technique. **`inert` on the wrapper fixes it in
one attribute** and also implies `aria-hidden`.

---

## 2. "Predict every bill" — the invisible range input

### 2.1 The control (confirmed)

Your finding is correct. Exactly one `input[type=range]` exists on the page.
Measured attributes and computed style:

```
class  = "absolute inset-x-0 bottom-0 z-10 h-3.5 w-full cursor-grab opacity-0 active:cursor-grabbing"
min    = "0"     max = "1"     step = "0.001"     value = "0.213" (on load)
aria-label = "Monthly ingest"
attributes present: type, min, max, step, aria-label, class, value   (no role, no aria-valuetext)
rect   = 814 × 14 px
computed: opacity 0 · position absolute · z-index 10 · pointer-events auto
          cursor grab · touch-action auto · inset "32px 0px 0px"
```

Source, verbatim:

```jsx
<input type="range" min={0} max={1} step={.001} value={e}
  onChange={e => t(parseFloat(e.target.value))}
  onPointerUp={e => r?.(parseFloat(e.target.value))}
  onKeyUp={e => r?.(parseFloat(e.target.value))}
  aria-label={n}
  className="absolute inset-x-0 bottom-0 z-10 h-3.5 w-full cursor-grab opacity-0 active:cursor-grabbing" />
```

**The split between `onChange` and `onPointerUp`/`onKeyUp` is the whole trick.**
`onChange` fires per input event and drives only the cheap visual; the expensive
recompute (`onValueCommit` → WASM quote → competitor bars) fires once on release.

I verified this empirically with a `MutationObserver` on the section:

| Action | Mutations observed | Mutation kinds |
| --- | --- | --- |
| 20 synthetic `input` events (a drag) | **116** | `characterData #text`, `attributes DIV` only |
| 1 `pointerup` (the commit) | **28** | same kinds, plus the URL changed to `axiom.co/?ingest=21183` |

So committing also **writes the value into a query param** — the calculator state
is deep-linkable, and only on release, so drag doesn't spam history.

### 2.2 What moves, and how

The component is `BellSlider`. Signature with defaults, verbatim:

```js
BellSlider({value, onValueChange, onValueCommit, ariaLabel, accent,
  barCount = 130, marks = [], showTiers = !0, thinLabels = !0,
  pill, pillSuffix, showPill = !0, barsClassName, responsive = !1,
  label, labelPosition = "top", baseHeight = 8, maxHeight = 19,
  sigma = 1.8, fadePx = 90, barWidth = "1.5px", className})
```

The landing-page instance overrides:

```jsx
<BellSlider accent="var(--green-11)" barCount={200} barsClassName="max-md:hidden"
  baseHeight={10} maxHeight={22} fadePx={110} barWidth="2px" responsive
  label="INGEST / MONTH" ariaLabel="Monthly ingest"
  value={w} onValueChange={j} onValueCommit={e => b(Math.round(p(e)))}
  pill={x($)} pillSuffix="/mo" marks={V} />
```

The core maths, verbatim:

```js
// bar height: a Gaussian bell centred on the thumb
function barHeight(i, t, g) {
  let n = i - t * (g.barCount - 1);
  return g.baseHeight + (g.maxHeight - g.baseHeight) * Math.exp(-(n*n) / (2*g.sigma*g.sigma));
}
// value <-> position is logarithmic, not linear
let logValue = (e, min, max) => Math.log(Math.min(Math.max(e,min),max)/min) / Math.log(max/min);
let logScale = (e, min, max) => min * Math.pow(max/min, e);
```

and the per-bar renderer:

```js
function Bar({index, spring, accent, geometry, width}) {
  let a = useTransform(spring, t => barHeight(index, t, geometry) / geometry.maxHeight);
  return <motion.span className="shrink-0 rounded-full"
           style={{width, height: geometry.maxHeight, originY: 1, scaleY: a, backgroundColor: accent}} />;
}
```

and the shared driver:

```js
let _ = useMotionValue(e);
useEffect(() => { _.set(e) }, [e, _]);
let S = useSpring(_, {stiffness: 400, damping: 40});
let N = useTransform(S, e => 100 * e);
let $ = useMotionTemplate`${N}%`;
let M = useMotionTemplate`radial-gradient(${b}px 80px at ${N}% 50%,
        #000 0%, rgba(0,0,0,0.8) 14%, rgba(0,0,0,0.2) 38%, rgba(0,0,0,0.1) 64%, transparent 100%)`;
```

DOM measurements confirming all of the above:

```
layer 1: div.absolute.inset-x-0.bottom-0.flex.items-end.justify-between  h=10px  200 children  mask: none
layer 2: div.absolute.inset-x-0.bottom-0.flex.items-end.justify-between  h=22px  200 children
         mask-image: radial-gradient(110px 80px at 21.2813% 50%, rgb(0,0,0) 0%, …)
400 spans total
one bar: width 2px · height 22px · transform matrix(1,0,0,0.454611,0,0) · transform-origin "1px 22px"
         background rgb(17,185,129)  (= --green-11 #11b981) · border-radius 1.67772e+07px
thumb:   left 173.227px · 28px · bg rgb(17,185,129) · 6px border in --background
```

So: **400 elements, and only two CSS properties move** — `scaleY` on 200 spans
(via `useTransform` off one shared spring) and the `%` inside one
`radial-gradient` mask. Nothing writes `height`, `width`, `top` or `left`. The
static grey base row underneath means the bell "lights up" rather than "grows",
so the silhouette never reflows.

### 2.3 Per-frame or stepped?

**Per-frame, on a spring, from source.** `step="0.001"` gives 1000 discrete input
positions across 814 px (≈0.8 px per step, sub-pixel — effectively continuous),
and the visual is a `useSpring` of that value, so it interpolates between input
events. It is *not* snapped to the `marks`. The `marks` are only tick dots and
labels, de-duplicated by minimum spacing:

```js
function thinMarks(e, t = .12) { /* drop any mark closer than 12 % of the track to its neighbour */ }
```

I could not watch the spring settle (background tab, no rAF), so the "per-frame"
claim rests on the source, not on observed pixels.

---

## 3. Scroll behaviour

### 3.1 There is no CSS scroll-driven animation

Concatenated all 10 stylesheets (231,205 chars total; the page ships **zero
`<link rel=stylesheet>`** — all CSS is inlined in 10 `<style>` tags) and counted:

| Pattern | Occurrences |
| --- | --- |
| `animation-timeline` | **0** |
| `scroll(` | **0** |
| `view(` | **0** |
| `@keyframes` | **8** — `spin, ping, pulse, bounce, enter, exit, accordion-down, accordion-up` (all Tailwind / tw-animate defaults) |

So the entire visual identity is built without a single bespoke CSS keyframe.

### 3.2 There is exactly one scroll-linked effect, and it is a sticky scrub

`AnimatedQuote`. Source, verbatim and complete on the essentials:

```js
let G = (e, t) => Math.min(t, Math.max(0, Math.round(e / .72 * t)));

function AnimatedQuote({quote, accent, attribution, cta, editableProps}) {
  let m = useReducedMotion(), h = useRef(null),
      {scrollYProgress: p} = useScroll({target: h, offset: ["start start", "end end"]}),
      f = quote.split(" "),
      g = [{id:"quote-open", text:"“", accent:!0},
           ...f.map((e,t) => ({id:`word-${t}`, text: e + (t < f.length-1 ? " " : ""), accent:!1})),
           {id:"quote-close", text:"”", accent:!0}],
      x = g.length,
      [v, y] = useState(m ? x : 0),      // reduced motion → start fully revealed
      [b, w] = useState(m);
  useMotionValueEvent(p, "change", e => { let t = G(e, x); y(t); t >= x && w(!0) });
  …
  let j = <blockquote className="text-foreground max-w-3xl text-2xl leading-[1.35] font-medium tracking-tight md:text-4xl">
            {g.map((e, r) =>
              <span className={cn("transition-opacity duration-500 ease-out", r < v ? "opacity-100" : "opacity-35")}
                    style={e.accent ? {color: accent} : void 0}>{e.text}</span>)}
          </blockquote>;
  let C = e => cn("transition-all duration-500 ease-out",
                  b ? "translate-y-0 opacity-100 blur-0"
                    : "translate-y-8 opacity-0 blur-sm", e);
  return m
    ? <figure className="section my-24 flex flex-col items-center gap-8 text-center">{j}{k}</figure>
    : <div ref={h} className="relative h-[150vh] md:h-[220vh]">
        <figure className="section sticky top-0 flex h-screen flex-col items-center justify-center gap-8 text-center">{j}{k}</figure>
      </div>;
}
```

Five things worth naming:

1. **Classic sticky scrub**: tall outer wrapper + `sticky top-0 h-screen` inner.
   Measured live: wrapper **1657 px**, sticky figure **753 px** (= `100vh`),
   25 word spans → ≈**36 px of scroll per word**.
2. **`e / .72`** — the quote is fully lit at **72 % of scroll progress**. The last
   28 % is dwell time so the finished sentence sits on screen before it leaves.
3. **The per-frame work is one integer compare.** `scrollYProgress` → a word
   *count*; the 25 spans only toggle a Tailwind class. Measured on the live
   spans: `transition-property: opacity`, `duration 0.5s`,
   `timing-function cubic-bezier(0, 0, 0.2, 1)` (Tailwind `ease-out`), toggling
   `opacity-100` ↔ `opacity-35`. No inline styles are written per frame.
4. **Reduced motion swaps the layout, not just the animation.** It returns a
   plain `my-24` figure — the 220 vh scroll trap disappears entirely and the
   state initialises fully revealed (`useState(m ? x : 0)`).
5. The attribution/CTA is the page's only large move: `translate-y-8` (32 px)
   + `blur-sm` + opacity, `transition-all duration-500 ease-out`, fired once the
   quote completes.

### 3.3 Section reveals: there aren't any

This is the single most surprising finding. I measured every heading and
paragraph on the page:

```
h1/h2/h3/p elements: 86
… with a transform or opacity on self or 3 ancestors: 6
… and all 6 are inside the agent-terminal demo ("❯ Let me confirm by using Axio…")
h2 computed: transform none · opacity 1 · transition all/0s · will-change auto
```

**Headings, ledes and body copy on axiom.co do not fade or rise on scroll at
all.** The only things that animate on entry are (a) the product-demo internals,
and (b) the sticky quote. Everything else is simply painted.

`will-change` is set on exactly **2 elements** page-wide, both `transform`, both
NumberFlow-related. 421 elements carry an inline `transform` and 485 an inline
`opacity` — all of them motion-driven demo internals.

Where reveals *do* exist they are `once` — 27 `once:!0`, zero repeating triggers.

### 3.4 Scroll/observer plumbing

`new IntersectionObserver` appears 6× in the bundle: 2 in floating-ui's
`autoUpdate`, 2 in motion's `useInView`/`whileInView`, 1 in motion's scroll
driver, 1 in the WebGL background (§4). `addEventListener("scroll")` appears 4×:
floating-ui ×1, motion's scroll driver ×3. **There is no hand-rolled scroll
handler in application code.** The header is `position: sticky; top: 0` with an
opaque `--background` fill, a 1 px `border-border/50` bottom rule, 65 px tall, and
**no backdrop-filter and no scroll-state change**.

---

## 4. The canvases (bonus: a shader, and a good render loop)

Three `<canvas>` on the page:

| # | Context | Backing store | CSS size | Position |
| --- | --- | --- | --- | --- |
| 0 | `webgl` | 2416 × 1340 | 1208 × 670 | hero, `absolute top-[-60%] left-[40%]`, `pointer-events-none` |
| 1 | uninitialised in my session (300 × 150 default) | — | 300 × 150 | "Visibility shrinks as you grow" card, section 2 |
| 2 | `webgl` | 1440 × 1340 | 720 × 670 | final CTA section |

Canvases 0 and 2 are a component exported as **`VercelGlow`** (the name is in a
`console.warn("vercel-glow:", …)` string). It is a full-screen-quad fragment
shader — `drawArrays(TRIANGLE_STRIP, 0, 4)` over `Float32Array([-1,-1,1,-1,-1,1,1,1])`
— with uniforms `u_resolution`, `u_time`, `u_intro`. The GLSL ships with its
comments intact:

```glsl
uniform vec2 u_resolution;  uniform float u_time;  uniform float u_intro;
const vec2 D = vec2(0.70710678, -0.70710678);
const vec2 N = vec2(0.70710678,  0.70710678);
const vec2 GC = vec2(400.0, 358.0);
float core(float q, float w) { float sigma = max(w, 0.8 * px); return exp(-(q*q)/(2.0*sigma*sigma)); }
float prog(float st) { return smoothstep(st, st + 0.55, u_intro); }
// A shine wavefront that travels bottom-left -> top-right along the lines
// every sweepPeriod seconds, then rests off-canvas for the remainder of the
// cycle. ph gives each line a slight stagger so they don't fire in lockstep.
```

Sweep period is 8.0 s with a 2.0 s initial hold; the orange ramp is
`vec3(0.980,0.533,0.004) → (0.776,0.341,0.004) → (0.212,0.086,0.004)`, i.e. the
brand orange. `core()` floors the Gaussian sigma at `0.8 × px`, so line thickness
never drops below a pixel — antialiasing without MSAA.

The render loop is worth copying wholesale:

```js
let t = e.getContext("webgl", {alpha:!0, antialias:!1, depth:!1, stencil:!1,
                               premultipliedAlpha:!0, powerPreference:"low-power"});
let r = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
…
let x = () => {                                    // draw one frame
  let a = r ? 3e4 : f,                             // reduced motion: freeze u_time at 30 s
      s = r ? 1 : Math.min(1, Math.max(0, (f - 150) / 3800)),   // 150 ms delay, 3800 ms intro
      l = s < .5 ? 4*s*s*s : 1 - Math.pow(-2*s+2, 3)/2;         // easeInOutCubic
  t.uniform2f(n, e, i); t.uniform1f(o, a/1e3); t.uniform1f(u, l);
  t.clearColor(0,0,0,0); t.clear(t.COLOR_BUFFER_BIT); t.drawArrays(t.TRIANGLE_STRIP, 0, 4);
};
let v = e => { m = 0; if (!p) { h = !1; return } f += Math.min(100, e - g); g = e; x(); m = rAF(v) };
let y = () => { r ? x() : (h || (h = !0, g = performance.now(), m = rAF(v))) };
let b = new IntersectionObserver(([e]) => { (p = e.isIntersecting) && y() }); b.observe(e);
let w = new ResizeObserver(() => { let t = Math.min(window.devicePixelRatio||1, 2), … });
```

- Reduced motion renders **one static frame at t = 30 s, intro = 1** and never
  starts the loop. The effect is present, just frozen at its settled state.
- `IntersectionObserver` gates the loop — offscreen means zero GPU work.
- `f += Math.min(100, e - g)` clamps the delta so a tab stall doesn't jump time.
- DPR clamped to 2 (`powerPreference: "low-power"`).

The second render loop (the 2D-canvas chart, canvas #1) adds two more guards:

```js
useEffect(() => { let e = window.matchMedia("(prefers-reduced-motion: reduce)");
                  reduced.current = e.matches; … }, []);
useEffect(() => { let e = () => { document.hidden || raf.current || (raf.current = rAF(tick)) };
                  document.addEventListener("visibilitychange", e); … }, []);
let tick = useCallback(() => {
  if (document.hidden) { raf.current = 0; return }
  let s = Math.min(window.devicePixelRatio || 1, 3),
      l = last.current ? Math.min(now - last.current, 50) : 16.67;   // delta clamp
  …
  let x = reduced.current;
  te.current = x ? W : lerp(te.current, W, .14, l);                  // reduced motion: snap
  …
}, …);
function lerp(cur, target, rate, dt = 16.67) {
  return cur + (target - cur) * (1 - Math.pow(1 - rate, dt / 16.67));  // fps-independent
}
```

That `lerp` is the frame-rate-independent form (not the naïve
`cur += (target-cur)*0.1`, which runs twice as fast at 120 Hz). The
reduced-motion branch **snaps to the target value** rather than skipping the
update. This is why canvas #1 stayed 300 × 150 for me: the backing-store resize
happens *inside* `tick`, which returns early while `document.hidden` — so a
backgrounded tab never sizes it.

---

## 5. Typography and colour

### 5.1 Fonts

Two, both self-hosted via `next/font/local`, both preloaded, both
`font-display: swap`, both with metric-matched fallbacks:

| Family | Weights | Fallback overrides |
| --- | --- | --- |
| **Geist** (variable) | `100 900` | `Geist Fallback`: `size-adjust 104.76%`, `ascent-override 95.94%` |
| **Berkeley Mono** (variable, licensed) | single axis | `berkeleyMono Fallback`: `size-adjust 131.49%`, `ascent-override 72.7%` |

`--font-sans: "Geist", "Geist Fallback"` · `--font-mono: "berkeleyMono", "berkeleyMono Fallback"`.
Preloads: `Berkeley_Mono_Variable-s.p.*.woff2`, `caa3a2e1cccd8315-s.p.*.woff2`.

The metric overrides are what let them use `swap` with no visible reflow.

### 5.2 Measured type scale (1512 px viewport, computed values)

| Role | Classes | font-size | line-height | weight | letter-spacing | colour |
| --- | --- | --- | --- | --- | --- | --- |
| h1 | `text-[40px] leading-10 md:text-7xl md:leading-17 font-medium tracking-tight` | **72 px** (40 px mobile) | **68 px** (0.944) | 500 | **−1.8 px** (−0.025 em) | `lab(98.26 0 0)` |
| h2 | `text-3xl leading-9 md:text-[40px] md:leading-11 font-medium tracking-tight` | **40 px** (30 px mobile) | **44 px** (1.1) | 500 | **−1 px** (−0.025 em) | `lab(98.26 0 0)` |
| Scroll quote | `text-2xl leading-[1.35] md:text-4xl font-medium tracking-tight` | **36 px** | **48.6 px** (1.35) | 500 | **−0.9 px** | `--foreground` |
| Hero lede | `text-secondary-foreground text-[15px] max-w-xl` | **15 px** | **22.5 px** (1.5) | 400 | normal | `lab(100 0 0 / 0.6)` |
| Card title (h3) | `font-medium tracking-tight` | **16 px** | **24 px** (1.5) | 500 | **−0.4 px** | `lab(98.26 0 0)` |
| Card body | — | **14 px** | **22 px** (1.571) | 400 | normal | `lab(100 0 0 / 0.6)` |
| Nav link / trigger | — | **13 px** | 19.5 px (1.5) | **450** | normal | `lab(100 0 0 / 0.6)` |
| Button label | — | **13 px** | 19.5 px | 500 | normal | white / `lab(98.26 0 0)` |
| Demo tab label | `text-[13px] font-medium` | 13 px | — | 500 | — | — |

Mono utilities, read from the served CSS:

```css
.mono-lg-medium  { font-family: var(--font-mono); font-size: .875rem; font-weight: 500; line-height: 1.25rem }  /* 14/20 */
.mono-lg-regular { font-family: var(--font-mono); font-size: .875rem; font-weight: 400; line-height: 1.25rem }
.mono-md-regular { font-family: var(--font-mono); font-size: .75rem;  font-weight: 400; line-height: 1rem     }  /* 12/16 */
.mono-sm-regular { font-family: var(--font-mono); font-size: .625rem; font-weight: 400; line-height: 1rem     }  /* 10/16 */
```

Notes on the shape of this scale:

- **Only two weights of Geist are in real use: 450 and 500.** No bold anywhere in
  the page chrome. 450 (chrome/nav) vs 500 (headings, buttons) is a variable-font
  micro-distinction you cannot get from a static family.
- **Headings get sub-1.0 leading** (72/68 = 0.944) while body stays at 1.5–1.57.
- `tracking-tight` (−0.025 em) on every heading; body copy has no tracking change.
- The mono scale is 10/12/14 px only — labels and data, never prose.

### 5.3 Colour tokens

461 CSS custom properties on `:root`. The system is **Radix Colors dark scales
(1–12)** exposed as raw hex, plus a shadcn-style semantic layer in `lab()`
(Tailwind v4's colour space). Scales present: `gray, red, orange, yellow, green,
blue, purple, tomato, amber, lime, teal, iris, pink, chart`.

```
--gray-1 … --gray-12
  #0c0c0c #111111 #222222 #2a2a2a #313131 #3a3a3a #484848 #606060 #6e6e6e #7b7b7b #b4b4b4 #eeeeee

--orange-1 … --orange-12          (brand accent; --orange-9 #f76b15 is the CTA)
  #17120e #26140d #331e0b #462100 #562800 #66350c #7e451d #a35829 #f76b15 #fa7440 #ffa057 #ffe0c2

--green-1 … --green-12            (used for the pricing slider; --green-11 #11b981)
  #0e1512 #121b17 #132d21 #113b29 #174933 #20573e #28684a #2f7c57 #30a46c #33b074 #11b981 #b1f1cb
```

```
--background          lab(2.47865% 0 0)      ≈ #060606, near-black
--foreground          lab(98.26% 0 0)        ≈ #fafafa
--card / --popover    lab(4.4379% 0 0)
--border              lab(11.84% 0 0)
--secondary-foreground lab(100% 0 0 / .6)    ← body copy is white @ 60 %, not a grey hex
--muted-foreground    lab(48.438% 0 0)
--input               lab(100% 0 0 / .15)
--ring                lab(48.496% 0 0)
--radius              .475rem  (7.6px)
--font-weight-normal/medium/semibold/bold  400 / 500 / 600 / 700
```

The Radix step discipline is visible in the markup: `bg-gray-1` panels,
`border-gray-3` hairlines, `text-gray-10` for dim mono labels, `text-gray-11` for
secondary text, `text-gray-12` for primary. Steps 4–8 are only used for
interactive states.

Layout rhythm: `.section` is `max-width: 1240px; padding-inline: 16px`. Content
sections are `py-14 sm:py-24` → measured **96 px top and bottom**. Heading block
to content gap: **40 px** (`gap-6 sm:gap-10`). Header height 65 px.

---

## 6. Performance and restraint

### 6.1 prefers-reduced-motion

**In CSS: effectively nothing.** Exactly two rules match `prefers-reduced-motion`
across all 231 KB of served CSS, and both are Tailwind variant utilities:

```css
@media (prefers-reduced-motion: reduce) { .motion-reduce\:transition-none { transition-property: none } }
@media (prefers-reduced-motion: no-preference) { @media (hover:hover) {
  .motion-safe\:hover\:animate-spin:hover { animation: var(--animate-spin) } } }
```

Both are **dead code on this page** — I counted `0` elements with a
`motion-reduce:*` or `motion-safe:*` class in the live DOM. There is no
`* { animation: none !important }` blanket rule.

**In JS: comprehensive.** In application code (chunk offset > 440 k) I counted
**9 `useReducedMotion()` call sites** and **4 raw
`matchMedia("(prefers-reduced-motion: reduce)")` reads**. The three patterns they
use, all verbatim:

1. **Swap the layout** — `AnimatedQuote` returns a static `my-24` figure instead
   of the 220 vh sticky scroll trap, with state pre-initialised to "fully
   revealed" (§3.2).
2. **Draw the settled frame, don't start the loop** — `VercelGlow`:
   `r ? x() : (h || (h=!0, …rAF(v)))`, with `u_time` pinned to 30 s and
   `u_intro` to 1 (§4).
3. **Snap instead of ease, and skip the ticker** — the canvas chart's
   `te.current = x ? W : lerp(te.current, W, .14, l)`; `StatCards` does
   `if (reduced) return` before its `setInterval`.

The lesson: none of these hide the element or remove the visual. Reduced motion
gets the **final state, rendered statically**.

### 6.2 Layout-property animation

Mostly avoided, with two deliberate exceptions:

**Avoided.** Bars use `scaleY` with `originY: 1` and a fixed `height`. Rules use
`scaleX`. The slider's mask moves a gradient stop, not an element. `animate:{width` → **0 matches** in the bundle. `layout` (motion's layout projection) → **0 matches**.

**Exception 1 — accordion height** (two instances, disclosure panels):

```jsx
<motion.div initial={{height:0, opacity:0}} animate={{height:"auto", opacity:1}}
            exit={{height:0, opacity:0}} transition={{duration:.22, ease:"easeInOut"}}
            className="overflow-hidden bg-gray-1">
```

220 ms, on a container that is offscreen-adjacent. Pragmatic, bounded.

**Exception 2 — competitor comparison bars** (4 elements, measured live):

```
div.h-full.rounded-full.bg-foreground/20.transition-[width].duration-500
  transition-property: width · duration 0.5s · cubic-bezier(0.4, 0, 0.2, 1)
  measured widths: 166.758px, 166.758px, 928.539px, 1144px
```

Four elements, fired once per slider **commit** (not per drag frame). Also
bounded.

`transition-property: all` appears on 35 elements (nav triggers, links) at
**0.15 s** — Tailwind's `transition-all` default, used for hover states only.

### 6.3 The cost

| Item | Wire | Decoded |
| --- | --- | --- |
| HTML document (Brotli) | 170 KB | 1263 KB (653 KB of it inline RSC flight data) |
| `3q_lqofm6ckob.js` (main app+vendor chunk) | 437 KB | 1496 KB |
| `calculator.wasm` | 641 KB | 1948 KB |
| everything else (13 chunks, 2 fonts, analytics) | ≈ 458 KB | — |
| **Total** | **≈ 1706 KB** | — |

TTFB 83 ms, `domInteractive` 845 ms, `load` 1732 ms (backgrounded automation tab
— treat as indicative only). 3891 DOM nodes.

**They spent the budget on the demos, not on media.** Zero images, zero icon
fonts, zero chart library. But 1.7 MB is a lot, and ~640 KB of it is a WASM
pricing engine that only matters if a visitor drags one slider.

---

## 7. What RIFT should copy, adapt, or reject

RIFT is on the same stack (`motion@^12.40.0`, Next 16, React 19, Tailwind 4), so
these are direct.

### Copy

| # | Technique | One-line reason |
| --- | --- | --- |
| 1 | **Invisible native `input[type=range]` over a custom visual** — `opacity-0 absolute inset-x-0 h-3.5 cursor-grab`, `min 0 / max 1 / step .001`, `aria-label` | Free keyboard support, touch behaviour, and screen-reader semantics for zero custom code; `RunScrubber.tsx` should be built this way if it isn't. |
| 2 | **Split `onChange` (cheap visual) from `onPointerUp`/`onKeyUp` (expensive commit)** | Measured 116 mutations across a 20-step drag vs 28 on commit — the expensive path runs once per gesture, not once per frame. |
| 3 | **One shared `useSpring` MotionValue + N `useTransform` subscribers** driving `scaleY` on plain spans | 200 animated bars with zero React re-renders and zero layout; this is how RIFT's `ModelConstellation` / `MetalSheen` should be driven. |
| 4 | **`{stiffness: 400, damping: 40}`** for direct-manipulation feedback | Damping ratio exactly 1.0 — fast, no overshoot; a workbench should never bounce, and this is the number that guarantees it. |
| 5 | **`useInView(ref, {amount: .3, once: true})` gating demo animations** | 27 `once` sites and zero repeating triggers on axiom.co; re-animating on scroll-up is the thing that makes marketing pages tiring. |
| 6 | **Per-token opacity stagger for "typing"** — `delay: 0.035 * index, duration: 0.18, ease: "easeOut"` | Reads as typing but costs one class of animation and finishes in a computable, bounded time; far cheaper than a character interval timer. |
| 7 | **Frame-rate-independent lerp**: `cur + (target-cur) * (1 - Math.pow(1-rate, dt/16.67))` | RIFT's canvas/rAF code should use this instead of `cur += (t-cur)*k`, which runs at double speed on 120 Hz displays. |
| 8 | **rAF loop guards**: `IntersectionObserver` gate + `visibilitychange` gate + `Math.min(dt, 50)` clamp + DPR clamped to 2–3 | Four lines each; they are the difference between a background effect and a battery complaint. |
| 9 | **Reduced motion = render the settled state, statically** (freeze `u_time`, snap the lerp, pre-fill the reveal count) | Preserves the design for users who opted out, instead of showing them a blank box. |
| 10 | **`next/font/local` with metric-matched fallbacks** (`size-adjust`, `ascent-override`) + `font-display: swap` + preload | Zero-CLS font swap; RIFT should verify its own fallback overrides are generated, not just that fonts are preloaded. |
| 11 | **Commit slider state to a query param** (`?ingest=21183`), only on release | Makes a calculator result shareable at no cost and without polluting history during the drag. |
| 12 | **Two gradient fades + a 6 px concentric bezel** to bleed the product mock past the container | Sells "this is a real, larger application" without a screenshot; cheaper and sharper than an image at any DPR. |

### Adapt

| # | Technique | Reason to change it |
| --- | --- | --- |
| 13 | **Delete the generic section reveal.** RIFT's `Reveal.tsx` currently applies `translateY(22px)` over `0.65s` to every section. Axiom applies **none** to headings/copy — measured `transform: none, opacity: 1` on all 86 headings and paragraphs. | Reserve motion for the thing being demonstrated. If you keep a reveal, cut it to ≤8 px / ≤0.3 s (axiom's demo maximum is **6 px**), which is under the threshold where it reads as an effect. |
| 14 | **Adopt a fixed motion vocabulary and enforce it.** Axiom's whole page: durations {.15,.18,.2,.25,.3,.35,.5}, easings {easeOut ×34, easeInOut ×18, linear ×12}, springs ×1, `type:"spring"` ×0. | RIFT should publish the same table as tokens; the consistency is what makes their motion read as "system" rather than "each section had a different author". |
| 15 | **One sticky-scrub moment per page, not a scroll-driven page.** Axiom's is a 220 vh wrapper + `sticky top-0 h-screen`, full reveal at **72 %** progress, per-frame work = one integer compare + a class flip. | Scroll scrubbing is expensive attention; spending it once, on the testimonial, is the discipline. Copy the 72 % dwell and the "flip a class, don't write a style" implementation. |
| 16 | **Radix Colors 1–12 + a thin semantic layer.** Their gray runs `#0c0c0c → #eee` with panels at step 1, hairlines at step 3, dim labels at step 10. Body copy is `white / 0.6`, not a grey hex. | RIFT already has `--cursor-*` tokens from the Cursor forensics doc; the win to steal is the *numbered-step discipline* (panel/hairline/dim/primary always the same step) rather than the palette. |
| 17 | **The 450/500 weight pair and −0.025 em heading tracking.** h1 72/68 px, h2 40/44 px, body 14–15 px at 1.5–1.57, mono only at 10/12/14 px. | RIFT's current landing uses `font-semibold` and `clamp()` sizes; the two-weight variable-font approach reads more like an instrument and less like a marketing page. |
| 18 | **NumberFlow for changing figures** (`transformTiming: {duration: 900, easing: "linear(0,.005,.019,…)"}`, `opacityTiming: {duration: 450, ease-out}`) | The technique to take even without the dependency: **bake a spring into a `linear()` easing string** so the Web Animations API can run it off the main thread. |

### Reject

| # | Thing | Reason |
| --- | --- | --- |
| 19 | **`aria-hidden="true"` on an interactive demo with no `inert`.** Measured: 73 of 147 focusable elements on axiom.co sit inside `aria-hidden` subtrees, with `[&_button]:outline-none` and no `tabindex="-1"`. | ~73 invisible, unannounced tab stops. Use `inert` on the wrapper — it implies `aria-hidden` *and* removes the subtree from the tab order, in one attribute. RIFT's `HeroDemo.tsx` should ship `inert` from day one. |
| 20 | **`[&_button]:outline-none` as a global reset inside the demo.** | Kills the focus ring for anything that stays reachable; if a control is real, it needs a visible focus state. |
| 21 | **A 641 KB WASM pricing engine on the landing page.** | Axiom's page totals ≈1.7 MB. RIFT's pricing is simple enough for arithmetic in JS; buy the same interaction for ~0 KB. |
| 22 | **1263 KB of decoded HTML (653 KB inline RSC payload) to server-render a 567-node fake app.** | SSR'ing the mock is right — it makes the hero LCP-eligible with no image — but RIFT's demo should be a fraction of this node count. Budget the hero mock at ≤200 nodes. |
| 23 | **No `<noscript>` / no static fallback for the demos.** | Axiom gets away with it because the markup is SSR'd; but the *animated* state (bars at `scaleY: 0` until in view) means a JS failure leaves collapsed bars. Ship RIFT's initial variant as the resting state, not the hidden one. |
| 24 | **Relying on CSS for reduced motion.** Their only two `prefers-reduced-motion` rules are unused Tailwind variants; all the real handling is in JS. | That works, but it means an unaudited `transition` anywhere on the page silently ignores the preference. RIFT should keep a CSS backstop *and* the JS branches. |

---

## Source index

Every claim above maps to one of these:

- `https://axiom.co/` — live DOM, 1512 × 753, measured 2026-08-14 via
  `getComputedStyle` / `getBoundingClientRect` / `MutationObserver` /
  `PerformanceResourceTiming`.
- `https://axiom.co/_next/static/chunks/3q_lqofm6ckob.js` — 1,514,156 chars;
  source of every quoted `transition` / variant / shader / render loop.
  Component names quoted from its export table: `AxiomDashboard`, `BellSlider`,
  `AnimatedQuote`, `VercelGlow`, `Code`, `LogoGrid`, `StatCards`,
  `barHeight`, `buildMarks`, `logScale`, `logValue`, `thinMarks`.
- The 10 inline `<style>` elements (231,205 chars concatenated) — source of the
  `@keyframes` count, the `prefers-reduced-motion` rules, the `.mono-*`
  utilities, and the custom-property dump.
- `https://axiom.co/_next/static/media/calculator.*.wasm` — observed as a
  `fetch` initiator in `PerformanceResourceTiming`; role inferred from the string
  `"Failed to initialize the pricing runtime."` adjacent to its dynamic import.
- Selectors named inline where a measurement came from a specific element
  (`div.h-180`, `input[type=range]`, `figure[1]`, `canvas[0..2]`, `header`).
