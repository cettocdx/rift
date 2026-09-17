# /landing/x — the system it is built to

Reference: **gumloop.com**, measured with `getComputedStyle` on the live page,
26 Aug 2026, at a 1440px viewport. Nothing here is read off a screenshot.

This file replaces `ORCHID_LANDING_TEARDOWN.md`. That page was built to
orchid.ai for a day; what survived and what did not is recorded at the bottom,
because the components still carry comments explaining decisions that were
made under the old reference.

---

## 0. The shape of the argument

Gumloop is not a document and not a gallery. It is a short stack of sections,
each one *a claim over a picture of the product*, with very little air between
them. Its whole visual budget goes into the product stages; the type around
them is deliberately plain and gets out of the way.

---

## 1. Layout

| | gumloop | /landing/x |
|---|---|---|
| Container | `max-width: 1440px` · `padding-left: 40px` | same |
| Section padding | `py-10` → `lg:py-16` (40 / 64) | `py-14 md:py-16 min-[1280px]:py-20` (56 / 64 / 80) |

We sit one step above their 64 because our headings are larger than theirs and
a section needs a little more room to open.

The 1440 is not a coincidence with the stage width below — a stage fills its
container exactly, so the app renders at scale 1.0 on a desktop and is pixel
crisp.

---

## 2. Type

One family, one weight, one tracking rule.

```
H1            48 / 500 / lh 48 (1.0)  / -1.2px   = -0.025em
H2, H3 sect   36 / 500 / lh 45 (1.25) / -0.9px   = -0.025em
H3 card    18–20 / 500 / lh 28        / -0.45px  = -0.025em
body          16
```

**The signature is `-0.025em` at every size.** Four measurements, one decision.
It is most of why their page reads as a single object rather than a stack of
sections, and it is the cheapest thing on this list to get right.

There is no serif, no bold, and no second family. Emphasis is size only.

---

## 3. The product stage — the part worth stealing

Three nested elements:

```
stage    aspect-[1440/900] · bg-brand-subtle · rounded-md 8px · 1px border · overflow-clip
scaler   absolute top-0 left-0 origin-top-left · 1440×900 · transform: scale(k)
window   absolute top-10 right-10 bottom-32 left-48 · rounded 8px · shadow-floating · overflow-hidden
```

`k = containerWidth / 1440`. Measured on their hero: a 1354px container
carrying `matrix(0.940278, …)`, which is 1354/1440 exactly.

**Why this matters more than it looks.** The app is authored at a fixed
desktop size and *scaled*, never reflowed. Every breakpoint the app has stays
on its desktop side, so a reader sees the real product at a smaller size
instead of a narrow layout no signed-in user will ever meet. Before this,
our surfaces were being squeezed into a 1200px column and their 204px rails
and 310px activity panels were collapsing.

Other details:
- Traffic lights are 10px. The window is titled.
- Their stage content is plain DOM and 23 `<img>` — no iframe, canvas or video.
  Ours is the running product, which is the one place we go further.
- `max-sm:pointer-events-none` — below the small breakpoint the app becomes a
  picture, because at that scale nothing is tappable.

### Where ours differs, deliberately

- **No authored height.** Theirs is `1440/900` for both axes because every
  stage holds the same rebuilt screenshot. Ours hold three live surfaces
  measured at 392, 583 and 904 tall, so height is a per-surface prop.
- **The height is fixed, not measured.** Driving it from content made the
  window grow as a run streamed into it and pushed the page down under the
  reader's cursor. Each surface now declares a height that holds its fullest
  state: build 640, studio 720, workbench 1030.
- **The window is OLED black**, because `lib/appearance/presets.ts` ends with
  `dark: presetMode("oled", "dark")` — true black is what the product opens in.
  See `landing-v2/ProductFrame.tsx`, whose tokens are computed from
  `globals.css`'s own `color-mix` percentages rather than eyeballed.

---

## 4. Motion

**There is no motion library.** `document.querySelectorAll('[data-framer-name]')`
returns 0. Everything is CSS transitions on inline styles and Tailwind classes.

**Entrance**, visible on any element still below the fold:

```
filter: blur(2px); opacity: 0; transform: translateY(8px)
  →   blur(0px); opacity: 1; transform: none
0.5s cubic-bezier(0.77, 0, 0.175, 1)          /* easeInOutQuart */
```

A louder variant exists for one hero element: `blur(4px)` with `scale(0.25)`.

**Hover** is the dominant interaction — 130 `group-hover` elements — and runs
at `0.15s`.

Timing pairs, by count:

| duration · easing | count | role |
|---|---|---|
| `0.15s cubic-bezier(0.4,0,0.2,1)` | 162 | hover, standard |
| `0.15s cubic-bezier(0,0,0.2,1)` | 93 | hover, ease-out |
| `0.5s cubic-bezier(0.77,0,0.175,1)` | 82 | **entrance** |
| `0.2s cubic-bezier(0,0,0.2,1)` | 64 | small state changes |
| `0.5s cubic-bezier(0.625,0.05,0,1)` | 42 | larger transitions |

Animated properties, by count: `transform/translate/scale/rotate` (151),
colours (111), `fill, opacity` (93), `all` (60), `opacity` (41).

> Our own reveal blurred at **10px over 14px across 820ms** under the previous
> reference — roughly four times the reference on all three axes. A 10px
> defocus on a full-width application window is an effect a reader waits out;
> a 2px one is a settle they only feel. `reveal.tsx` now carries their numbers,
> and dropped its `will-change` with them: at 2px there is nothing to smooth
> and the hint promoted every unrevealed block to its own compositor layer.

Reduced motion is answered in `globals.css` under
`@media (prefers-reduced-motion: reduce)`, which clears `filter` as well as
transform and opacity — without the filter line the preference would pin every
block at `blur(2px)` permanently.

---

## 5. What came from elsewhere

**The closing band** is ported from `/landing/pi`, not from gumloop:
`PiPixelMark` at `anchorX 0.66 · scale 0.92`, a left-to-right scrim holding the
copy in the first third, a two-tone heading, and two square mono controls. The
mark is *imported* rather than duplicated so the two pages cannot drift. Its
square corners and mono buttons deliberately break this page's grammar; it is
the last block on the page and reads as a plate rather than another section.

**From orchid.ai**, which this page was built to before gumloop, three things
survived because they are structurally sound rather than stylistic:

- One ink and an alpha ladder, no second grey — `ink/80`, `ink/65`, `ink/30`.
- Rules at `0.5px` rather than 1px, and groups divided with `divide-*` so the
  outer edges of a group stay open instead of closing into a box.
- Colour admitted only inside media, never as a wash on the page.

What did not survive: the Newsreader display serif, the paper ground, and the
128/176/224 vertical rhythm. All three were orchid's and none of them fit a
page carrying three 1030px application windows.

**One departure from every reference:** the ink is pure black and every tint is
a neutral alpha of it. Orchid's is a navy that reads as black and behaves as
blue; a navy-tinted terminal reads as a theme rather than as a machine.

---

## 6. Checklist for the next change

- Tracking is `-0.025em`. At every size. Do not exempt small text.
- Weight is 500. There is no bold on this page.
- A group of things is divided by rules, not closed in a box.
- A number on this page can be checked against a module. If it cannot be
  derived, it does not get shown — see the metric strip in
  `HackWorkbenchMini`, which carries what the probe actually measured rather
  than the four fields the real app shows.
- A control that looks live must be live. The evidence-report buttons in the
  workbench link to `/signup` because the report needs an account.
