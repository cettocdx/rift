# Grok skill files, printed verbatim by Grok itself (17 Aug 2026)

List every skill/playbook file available in your workspace, then print the FULL verbatim contents of the ones you loaded this run (building-games, design-ui, threejs, og, imagine, auth) in your answer as fenced code blocks, one per file, with the file path as a heading. Do not summarize or shorten them.

4m 34s saniye çalıştı
Every skill/playbook file

Skills (SKILL.md)

.grok/skills/auth/SKILL.md
.grok/skills/building-games/SKILL.md
.grok/skills/controls/SKILL.md
.grok/skills/design-ui/SKILL.md
.grok/skills/game-animation-frames/SKILL.md
.grok/skills/game-asset-core/SKILL.md
.grok/skills/game-character-consistency/SKILL.md
.grok/skills/game-tilesets/SKILL.md
.grok/skills/game-ui-icons/SKILL.md
.grok/skills/generate2dmap/SKILL.md
.grok/skills/generate2dsprite/SKILL.md
.grok/skills/imagine/SKILL.md
.grok/skills/multiplayer-p2p/SKILL.md
.grok/skills/neon/SKILL.md
.grok/skills/og/SKILL.md
.grok/skills/threejs/SKILL.md
.grok/skills/video2dsprite/SKILL.md
.grok/skills/xai-api/SKILL.md

References / extras

.grok/skills/building-games/references/3d-libs.md
.grok/skills/building-games/references/ai-pathfinding.md
.grok/skills/building-games/references/audio.md
.grok/skills/building-games/references/babylon.md
.grok/skills/building-games/references/collision-physics.md
.grok/skills/building-games/references/ecs-architecture.md
.grok/skills/building-games/references/game-feel-juice.md
.grok/skills/building-games/references/genres/board-card-chess.md
.grok/skills/building-games/references/genres/endless-runner.md
.grok/skills/building-games/references/genres/fps.md
.grok/skills/building-games/references/genres/platformer-2d.md
.grok/skills/building-games/references/genres/puzzle-match3-tetris.md
.grok/skills/building-games/references/genres/racing-kart.md
.grok/skills/building-games/references/genres/topdown-twin-stick.md
.grok/skills/building-games/references/genres/tower-defense.md
.grok/skills/building-games/references/genres/voxel-minecraft.md
.grok/skills/building-games/references/input.md
.grok/skills/building-games/references/phaser.md
.grok/skills/building-games/references/procedural-generation.md
.grok/skills/building-games/references/save-persistence.md
.grok/skills/building-games/references/threejs-foundational.md
.grok/skills/design-ui/references/animations.md
.grok/skills/design-ui/references/performance.md
.grok/skills/design-ui/references/refined-ui.md
.grok/skills/design-ui/references/surfaces.md
.grok/skills/design-ui/references/typography.md
.grok/skills/generate2dmap/LICENSE
.grok/skills/generate2dmap/SOURCE.md
.grok/skills/generate2dmap/references/layered-map-contract.md
.grok/skills/generate2dmap/references/map-strategies.md
.grok/skills/generate2dmap/references/prop-pack-contract.md
.grok/skills/generate2dmap/scripts/compose_layered_preview.py
.grok/skills/generate2dmap/scripts/extract_prop_pack.py
.grok/skills/generate2dsprite/LICENSE
.grok/skills/generate2dsprite/SOURCE.md
.grok/skills/generate2dsprite/references/modes.md
.grok/skills/generate2dsprite/references/prompt-rules.md
.grok/skills/generate2dsprite/scripts/generate2dsprite.py
.grok/skills/generate2dsprite/scripts/make_layout_guide.py
.grok/skills/threejs/references/llms-full.txt
.grok/skills/video2dsprite/LICENSE
.grok/skills/video2dsprite/SOURCE.md
.grok/skills/video2dsprite/references/pipeline.md
.grok/skills/video2dsprite/references/prompt-rules.md
.grok/skills/video2dsprite/scripts/video2dsprite.py
/workspace/.grok/skills/building-games/SKILL.md
Markdown
Kopyala
---
name: building-games
description: >
Build browser games and interactive/canvas/3D experiences in this TanStack
Start + React app. Use for any game, simulation, or WebGL/Canvas experience —
2D or 3D, single-player. Covers the game loop & timing, 3D orientation/camera
conventions, collision, performance, assets, audio, save, game feel, and
per-genre playbooks. For WASD / vehicle / flight **input signs and inverted
A/D**, open the **`controls`** skill — do not rely on this file or racing-kart
alone. Triggers on "game", "minecraft", "fps", "platformer", "racing",
"tetris", "snake", "shooter", "3d", "three.js", "canvas", "voxel", "physics".
metadata:
short-description: "Browser games: loop, 3D orientation, camera, perf, assets, genres"
user-invocable: false
---

# Building Games

Build a **playable, correct** browser game — not a static screenshot. A game is
just a React route with a `<canvas>` (or `<Canvas>` for R3F) plus DOM overlay UI.
Style the overlay (start screen, HUD, menus) with the **`design-ui`** skill; this
skill owns the gameplay loop and world.

**Controls / inverted A/D:** open **`.grok/skills/controls/SKILL.md`** **before**
writing WASD, steering, or flight input. Vehicle/flight demos often ship with
A/D flipped if you only read this file or a single genre playbook.

**Scope note — single-player, bots, or small P2P co-op:**
- Ship **single-player** or **single-player + AI/bots** by default.
- **2–8 player co-op / casual realtime** (shared cursors, party games, casual
action among friends) is supported — use the **`multiplayer-p2p` skill**
(WebRTC mesh, signaled at `/api/rtc`). Read its trust model first.
- P2P is the only supported multiplayer right now. Do not half-build sockets
that can’t connect.

**References (load on demand):**
- **`controls` skill** (`../controls/`) — **required** for movement/steer/flight:
player-visible A/D, inverted-steer anti-pattern, flight ailerons, mandatory
self-test + `window.__controlsTest`. Not optional for vehicles/planes.
- `references/threejs-foundational.md` — the deep 3D/loop/perf reference. Read for 3D.
- `references/3d-libs.md` — three.js + @react-three/fiber + drei + rapier usage.
- **`threejs` skill** (`../threejs/`) — official full Three.js + TSL API dump
(`llms-full.txt`). Load for advanced materials/shaders/WebGPU/loaders; not for
simple 2D canvas games.
- `references/babylon.md` — Babylon.js, the batteries-included 3D engine alternative.
- `references/phaser.md` — Phaser 3, the default engine for 2D games.
- `references/ecs-architecture.md` — entity-component-system structure for larger games.
- `references/genres/*.md` — per-genre playbooks (fps, platformer-2d, racing-kart,
puzzle-match3-tetris, voxel-minecraft, endless-runner, topdown-twin-stick,
tower-defense, board-card-chess). Genre files **do not** replace **`controls`**.
- `references/game-feel-juice.md`, `input.md`, `audio.md`, `collision-physics.md`,
`save-persistence.md`, `procedural-generation.md`, `ai-pathfinding.md`.
- **`game-asset-core`** (+ `game-animation-frames` / `game-tilesets` /
`game-character-consistency` / `game-ui-icons`) — engine-ready 2D art defaults
and verification when generating sprites, sheets, tiles, or UI (see §6).

Pick the specific genre/topic reference for the build; this file is the universal
core for loop/world. **Input signs → `controls`.** **2D game art → `game-asset-core`.**

---

## 1. Game loop & timing (the #1 correctness issue)

- Drive the loop with the engine's RAF loop (`renderer.setAnimationLoop`, R3F
`useFrame`, or `requestAnimationFrame` for 2D canvas). **Never** `setInterval`/
`setTimeout`/`Date.now()` for game timing.
- **Scale ALL movement/animation by delta time** (seconds) so speed is frame-rate
independent (60Hz vs 144Hz). Compute delta **once per frame** and reuse it.
- three.js: use `THREE.Timer` (not `Clock` — `Clock.getDelta()` returns ~0 on a
second call in the same frame, a classic freeze bug).
- **Cap delta** (`min(delta, 0.1)`) so a backgrounded tab doesn't teleport things.
- **Fixed timestep for physics/gameplay:** accumulate delta and step simulation at
a fixed rate (e.g. 1/60) while rendering at display rate — prevents tunneling and
non-determinism.

## 2. Controls (delegate to the `controls` skill)

**Open `.grok/skills/controls/SKILL.md` before implementing any WASD / steer /
flight code.** That skill is the source of truth for:

- Player-visible **A = left / D = right** (chase cam, while moving forward)
- Why **`KeyA → steer−` + `yaw += steer * +rate` inverts** (most common bug)
- Vehicle vs FPS (strafe ≠ steer), fixed-wing ailerons, heli/drone notes
- Mandatory self-test + `window.__controlsTest` probe

Do **not** treat `genres/racing-kart.md` as the only place steer signs live —
planes, jetskis, and mechs never open it.

**Short reminder (full detail in `controls`):**

// Vehicle yaw body (chase cam): A must increase yaw with this basis
forward = (-sin(yaw), 0, -cos(yaw))
// KeyA → steer = +1; yaw += steer * turnRate * speedFactor * dt
// WRONG (ships inverted): KeyA → steer = -1; yaw += steer * turnRate * dt

text
Kopyala
- **Pointer lock:** mouse-look only — implement WASD yourself; click-to-play
overlay; dismiss on lock.
- Track keys with held state + **dt**; unify devices via `references/input.md`.
- **Finish:** run the `controls` skill checklist. Screenshot-only is insufficient
for vehicles/flight.

## 3. 3D orientation & world objects (the "sideways/backwards" bugs)

- three.js is **right-handed, +Y up**: +X right, +Y up, +Z toward viewer. **Meshes
face +Z; cameras look −Z** (the classic "camera backwards" gotcha).
- Primitives like `Cone`/`Cylinder` point **+Y** by default → rotate to align a
tip with forward (`geo.rotateX(Math.PI/2)`).
- **Orienting a mesh to face `forward`** (meshes face **+Z**): simplest correct way
is `mesh.lookAt(mesh.position.clone().add(forward))`. To build the basis by hand,
set the **+Z column to `forward`** and choose the x-axis that keeps it a *proper*
right-handed rotation (`det = +1`):
`xAxis = normalize(cross(up, forward))`, then `makeBasis(xAxis, up, forward)`.
Note this is `cross(up, forward)` — **not** the movement `right = cross(forward, up)`
from §2. Targeting +Z (instead of a camera's −Z) flips the x-axis sign so that
`xAxis × up = forward`; the frame stays right-handed (no mirroring). Do **not** use
`makeBasis(xAxis, up, -forward)` for a mesh — that targets −forward (the *camera*
convention) so the mesh faces **backwards**.
- **Orienting a camera** to look along `forward` (cameras look **−Z**): set the +Z
column to `-forward` — `xAxis = normalize(cross(forward, up))`, then
`makeBasis(xAxis, up, -forward)` (or just `camera.lookAt(target)`).
- Keep a consistent world `up` so objects stay upright; only rotate flat primitives
to stand up.
- Verify glTF import orientation; debug with `AxesHelper`/`ArrowHelper`. Upright
self-test: characters stand on the ground plane, not lying/sunk.

## 4. Camera must agree with movement

- Keep a **dedicated `moveForward`/`moveRight`** for movement, computed once and
never mutated by camera code (aliasing a shared temp vector makes camera and
movement disagree — a real repro bug).
- Third-person follow: `desired = playerPos + up*height + moveForward*(-followDist)`;
lerp the camera toward it (use exp-based smoothing, delta-scaled), `lookAt(player)`.
- Isolate-the-layer debug order: (1) keys register → (2) movement signs correct →
(3) camera agrees. Fix in that order.

## 5. Performance

- **Minimize draw calls** (`renderer.info.render.calls`, target <100): share
materials, `InstancedMesh`/`BatchedMesh` for repeated objects, atlases.
- **Dispose GPU resources yourself** (`geometry/material/texture.dispose()`) on
level change — three.js does not GC them. **Pool** bullets/enemies/particles.
- No per-frame allocations (reuse temp vectors). Compress textures; LOD for distance.

## 6. Assets (avoid the generated-photo trap)

- **Interactive 3D elements** (weapon viewmodels, characters, props, projectiles)
→ build from **3D geometry / glTF**, not a generated image. A flat photorealistic
JPG of a gun-in-hands used as an FPS viewmodel looks wrong, can't animate, and
(JPG has **no alpha**) renders as a black box. Parent a real 3D viewmodel to the
camera as an overlay render layer.
- Reserve image generation for **flat 2D** assets only (textures, sky/menu
backgrounds, 2D sprites, UI art). **Never** use a generated photo as a 3D mesh,
viewmodel, or character substitute — build those in 3D geometry / glTF.
Set `crossOrigin="anonymous"` on images drawn to canvas/textures.
See the **`imagine`** skill (2D only — image tools cannot produce real 3D).
- **Engine-ready game art doctrine** → open **`game-asset-core`**
(`../game-asset-core/`) for defaults + blind verify + retry discipline, then the
matching specialist: **`game-animation-frames`** (loop / motion laws),
**`game-tilesets`**, **`game-character-consistency`**, **`game-ui-icons`**.
These are **QC/doctrine**, not the export pipeline. Do not ship stick-figure
placeholders when real art is expected.
- **2D game sprites / animation sheets** → run **`generate2dsprite`**
(`.grok/skills/generate2dsprite/SKILL.md`): solid **`#FF00FF`** magenta
`imagine_text_to_image` sheets + chroma postprocess scripts (magenta is required for the
processor). Wire transparent PNGs/GIFs into Canvas/Phaser. Still apply
**`game-asset-core`** (+ animation/character specialists when relevant).
- **2D maps / levels / prop packs** → open **`generate2dmap`**
(`.grok/skills/generate2dmap/SKILL.md`). Prefer foundation-only base + separate
props/collision for playable maps. Browser default: `raw_canvas` / Phaser.
Tileable ground/walls → also **`game-tilesets`** for 2×2 seam checks.
- **Optional denser locomotion** → run **`video2dsprite`** (Grok
`imagine_image_to_video` + sandbox scripts; magenta base). Prefer `generate2dsprite`
for crisp production heroes. Use **`game-animation-frames`** for loop/flip-test
laws; prefer **`video2dsprite`** over ad-hoc ffmpeg-only harvest in this
sandbox.

## 7. Audio, save, feel
- **Audio**: unlock `AudioContext` on the first user gesture (tap-to-start) or iOS
is silent; re-resume on `visibilitychange`. (`references/audio.md`)
- **Save**: `localStorage`/IndexedDB with a `version` field + migrations.
- **Juice**: screen shake, hit-stop, eased tweens, particles — cheap, huge
perceived-quality lift. Keep presentation separate from simulation.

## 8. Mobile
- Distinguish canvas buffer size from CSS size; respect `devicePixelRatio`.
- `touch-action: none`, letterbox-fit to a base resolution, handle orientation.
- Touch controls (virtual joystick + action buttons), ≥44px targets.

---

## Stack / engine choice
- **3D → three.js**, ideally via **@react-three/fiber + drei** (fits the React
app; drei gives pointer-lock/controls/loaders) + **@react-three/rapier** for
physics/character controllers. See `references/3d-libs.md`.
- **2D →** native Canvas 2D is enough for snake/tetris/flappy/platformer; reach for
Phaser only when the genre needs it.
- These game deps are **not preinstalled** — `npm install` them (and make sure they
land in `package.json` so the Vercel build has them).

## Finish criteria (before "done")
- Loads with **no console errors**; visible gameplay (not a blank canvas).
- **`controls` skill self-test passed** (A = left / D = right from chase cam
while moving forward; flip one sign if inverted). Not screenshot-only.
- 3D upright & camera-agrees self-tests pass (§3, §4).
- Runs on mobile viewport with touch controls.
- Production build (`npm run build`) renders the built output, not just dev.
- **Share / X card:** open the **`og`** skill — custom `public/og.jpg` **and**
root meta `{ property: "og:type", content: "x:game" }` (always, not gated on
host). X uses `og:type="x:game"` to present the unfurl as a game card; do not
use `twitter:card` or invent `x:type` for this. `browser-smoke` /
`brand-check` warn when canvas apps omit it.
/workspace/.grok/skills/design-ui/SKILL.md
Markdown
Kopyala
---
name: design-ui
description: >
Design and build polished, non-generic UI for this TanStack Start + React +
Tailwind v4 + shadcn/Radix app. Use whenever you create or restyle any
interface surface — pages, landing pages, dashboards, forms, modals, nav, and
game overlays (start screens, HUD, menus). Covers design tokens, layout,
typography, color, spacing, motion, and the anti-"AI-slop" rules that keep
output from looking generic. Triggers on "design", "UI", "make it look good",
"polish", "landing page", "theme", "style", "redesign", "ugly", "clean up".
metadata:
short-description: "Polished, non-generic UI: tokens, layout, type, color, motion, anti-slop"
user-invocable: false
---

# Design & UI

Make interfaces that look intentional and premium, not template-generic. This is
the single biggest quality lever in the app builder. Apply it to **DOM / overlay
UI** — pages, chrome, HUD, menus, forms. (For a 3D game's gameplay canvas, see
the `building-games` skill; this skill governs the DOM UI layered over it.)

**Read `references/` for depth** (loaded on demand — don't inline it all):
- `references/refined-ui.md` — the full product-chrome/overlay design system.
- `references/typography.md` — type scale, pairing, rhythm.
- `references/surfaces.md` — elevation, borders, shadows, layering.
- `references/animations.md` — motion, easing, transitions.
- `references/performance.md` — keep UI smooth (60fps, no jank).

---

## 1. Design-system-first (do this before styling anything)

Define the system once, then compose from it. **Never** sprinkle ad-hoc values.

- **Tokens in CSS (Tailwind v4 is CSS-first).** Put the palette, radii, and fonts
in `src/styles.css` under `@theme` as CSS variables; consume them as Tailwind
utilities. One source of truth.
```css
@import "tailwindcss";
@theme {
--color-bg: #0b0b0f; --color-surface: #16161d;
--color-fg: #e7e7ea; --color-muted: #a0a0ab;
--color-primary: #14b8a6; --color-border: #26262f;
--radius: 0.75rem; --font-sans: "Inter", system-ui, sans-serif;
}
Use shadcn/ui components (Radix primitives + cva variants + tailwind-merge)
for buttons, dialogs, dropdowns, inputs, etc. They're accessible and consistent.
Generate them into src/components/ui; style via tokens, not inline hex.
Tailwind v4 base fix — buttons need a pointer cursor. v4's Preflight makes
<button> use cursor: default, which feels broken. Add this once in
src/styles.css so buttons/clickable roles show a pointer:
CSS
Kopyala
@layer base {
button:not(:disabled),
[role="button"]:not(:disabled) { cursor: pointer; }
}
Ban ad-hoc styling: no raw hex in JSX, no text-white/bg-black literals,
no arbitrary values like p-[16px] or text-[13px]. If you need a value,
it becomes a token or a scale step.
2. The quantified rubric (cheap rules that prevent "ugly")
≤ 3–5 colors total (one primary + neutrals + at most one accent). No random
extra hues. Don't default to purple unless asked.
≤ 2 font families (often one). Pair a display/heading with a body, or use one.
Line-height 1.4–1.6 for body; tighter for large headings.
When you override a background color, override the foreground/text color too
(contrast must hold — check both light and dark).
Mobile-first: design the ~390px layout first, then scale up. No horizontal
overflow; tap targets ≥ 44px.
Consistent spacing scale (4/8-based). Generous whitespace beats cramming.
One accent, used sparingly for primary actions — not everywhere.
3. Anti-AI-slop (the tells that make output look generic — avoid)
No gradient-blob filler, no giant hero gradients as a substitute for content.
No emoji as icons — use a real icon set (lucide-react).
No hand-drawn SVG illustrations/maps/charts — use real libraries (recharts
for charts) or real generated images.
No placeholder images / lorem-gray boxes in the final product — generate
real images or use real content; set crossOrigin="anonymous" on canvas images.
Avoid the overused-font look (default system-only, or Comic Sans-tier picks).
Every element earns its place. Cut decorative noise. Establish a system,
then vary with intent — not randomness.
Match the existing UI when editing an app in place; don't introduce a second
visual language.
4. Layout & hierarchy
Clear visual hierarchy: one primary action per view; size/weight/color express
importance. See references/typography.md and references/surfaces.md.
Use real layout structure (grid/flex, container max-widths), not absolute-position
hacks. Align to a consistent grid.
Empty states, loading states, and error states are part of the design — don't
ship blank/janky intermediate states.
5. Motion (subtle, purposeful)
Short, eased transitions (150–250ms) on hover/press/enter; respect
prefers-reduced-motion. Details in references/animations.md.
Never animate layout in a way that causes jank; prefer transform/opacity.
6. Game overlays (when this pairs with building-games)

The gameplay canvas is owned by building-games. This skill styles the DOM
overlay: start/"click to play" screen, HUD, score, menus, pause, mobile
controls. Keep overlay readable over the canvas (backdrop, contrast), and keep it
out of the pointer-lock/gameplay input path.

Finish checklist (before you call UI done)
Tokens defined in @theme; no ad-hoc hex / arbitrary values in JSX.
≤ 5 colors, ≤ 2 fonts, consistent spacing scale.
Contrast holds; foreground overridden wherever background is.
Mobile (~390px) has no overflow; targets ≥ 44px.
Real icons/images/charts — none of the anti-slop tells.
Loading/empty/error states handled; motion subtle and reduced-motion-safe.
Rendered and eyeballed in a browser (see AGENTS.md verification), not just curl.
text
Kopyala
## `/workspace/.grok/skills/threejs/SKILL.md`

```markdown
---
name: threejs
description: >
Official Three.js API and TSL (Three.js Shading Language) reference for LLM
code generation. Load when writing or debugging three.js / WebGL / WebGPU /
custom materials / shaders / GLTF / advanced three APIs beyond basic game
loop/controls. Prefer building-games for game correctness (loop, WASD,
camera, orientation); use this skill for full API/TSL depth. Triggers on
"three.js", "threejs", "WebGPU", "TSL", "NodeMaterial", "shader", "GLTF",
"MeshStandard", "OrbitControls", "WebGLRenderer".
metadata:
short-description: "Three.js + TSL full API (official llms-full reference)"
user-invocable: false
---

# Three.js (official LLM reference)

This skill vendors the **official** Three.js LLM documentation pack so the agent
can generate correct modern three.js without inventing outdated CDN/r128 APIs.

## Stack adaptation (this app builder)

You are in a **TanStack Start + React** workspace, not a bare HTML page:

| Official doc pattern | Do this here instead |
| --- | --- |
| `<script type="importmap">` + CDN three | **`npm install three`** (+ `@types/three` if needed); import from `"three"` / `"three/addons/…"` |
| Raw HTML canvas bootstrap | Prefer **@react-three/fiber + drei** for games/UI integration (`building-games` + `3d-libs.md`) |
| Standalone `WebGLRenderer` demo | Fine for a self-contained canvas module; still install three via npm so Vercel build has it |
| Always “latest” CDN version | Pin via **package.json** so dev and deploy match |

**three is not preinstalled** — add it with npm and leave it in `package.json`.

## When to load what

1. **Game / interactive 3D product** → start with **`building-games`** (loop, controls, orientation, camera, first-run, steer sign).
2. **R3F / drei / rapier wiring** → `building-games/references/3d-libs.md`.
3. **Deep three API, TSL, WebGPU, materials, loaders, postprocessing** → load
**`references/llms-full.txt`** (this skill’s full official dump).

Do **not** load `llms-full.txt` for simple 2D canvas games (Pong, tetris, etc.).

## Full reference

**Read on demand:**

```text
references/llms-full.txt

Source: https://threejs.org/docs/llms-full.txt (pinned copy for offline sandbox use).

Contents include: modern imports, WebGLRenderer vs WebGPURenderer, TSL complete
reference, NodeMaterial, loaders, post-processing, compute, and API tables.

Quick defaults for this product
Prefer WebGLRenderer (or R3F default) unless the user needs TSL/WebGPU compute.
Cap pixel ratio (renderer.setPixelRatio(Math.min(devicePixelRatio, 2)) or R3F dpr={[1,2]}).
Dispose geometries/materials/textures on teardown (three does not GC GPU resources).
For games: still obey building-games control and orientation self-tests.
Finish check
three (and R3F stack if used) is in package.json and imports resolve.
No r128 / cdnjs script-tag patterns.
If TSL/WebGPU used: materials and imports match llms-full (node materials, await renderer.init()).
text
Kopyala
## `/workspace/.grok/skills/og/SKILL.md`

```markdown
---
name: og
description: >
Share-link previews and app identity for apps on *.grok.me: the og:image
card in the root head, the SVG favicon, and PWA icons for installable apps.
Use when scaffolding, renaming, or restyling the app — and for share /
unfurl / OG / Twitter card questions. A custom 1200×630 card from the app's
own art is the default — games of every kind (DOM board/word games
included), whimsical apps, creative tools, and brand-forward pages; only
plain utilities keep the placeholder. By default run the whole brand-asset
pass in a parallel background task (the `task` tool) while the app builds.
Triggers on "share", "rename", "app name", "OG", "Open Graph",
"twitter card", "unfurl", "og:image", "og:type", "link preview",
"social card", "thumbnail", "preview image", "favicon", "app icon",
"PWA", "manifest", "installable", "home screen", "SEO", "meta description".
metadata:
short-description: "Brand assets: og.jpg card, SVG favicon, PWA icons — parallel task by default"
user-invocable: false
---

# Share cards, favicon, and app icons

A deployed app (`https://{name}.grok.me`) unfurls with a 1200×630 card, and
every app (preview included) shows a favicon in the browser tab. Both are
wired in the root `head()` — AGENTS.md § "First scaffold" is the source of
truth for `src/routes/__root.tsx`. **Extend `__root.tsx`; never replace it
wholesale** (auth SSR, redesign, another skill's excerpt). Dropping `og:image`
or the favicon link ships a broken card / blank tab icon, and `npm run dev` /
`build` will not catch it.

## `og:type` for games (X game-card presentation)

**When the app is a game of any kind** (Canvas/WebGL *and* DOM board/word/
puzzle/quiz games), set this meta tag in the root `head()` **always** — it
does not need `VITE_PUBLIC_HOSTNAME` and must not be gated on `ogImage`:

```tsx
{ property: "og:type", content: "x:game" },

Why this exists: X (Twitter) uses og:type="x:game" when unfurling
*.grok.me links to present the card as a game rather than a generic
website. This is a product contract with X's card pipeline — keep the tag,
and do not "correct" it to website during refactors. Non-games should omit
og:type or use website (scraper default).

Why og:type content x:game (and not the alternatives)

This will live forever in every shipped game; pick the stable channel:

Option Verdict
<meta property="og:type" content="x:game"> Chosen. Stays on the standard OG content-type property; value is a namespaced type (x:game) so it cannot be confused with a future global OGP game type or bare website. X's card pipeline keys off this exact value to present the unfurl as a game. Do not shorten to bare game.
og:type="game" (no x:) Rejected. Looks like a global OGP type that does not exist on ogp.me; the product contract is the namespaced x:game string.
twitter:card Wrong layer for the game signal. Layout only (summary_large_image). It lives in the first-scaffold __root.tsx and PWA chrome (AGENTS.md) so every app gets it — do not treat this skill as the place that adds it. Never use it as the game type.
Separate x:type / x:card meta properties Do not invent. Extra properties double surface area (agents forget one of two tags). Namespacing inside og:type's content (x:game) is enough.

Example root meta slice for a game (with a custom card once published):

tsx
Kopyala
meta: [
{ charSet: "utf-8" },
{ name: "viewport", content: "width=device-width, initial-scale=1" },
{ title: APP_NAME },
// twitter:card=summary_large_image is first-scaffold / PWA chrome (every app).
// X uses og:type=x:game to present the unfurl as a game card (not a website).
{ property: "og:type", content: "x:game" },
...(ogImage
? [
{ property: "og:image", content: ogImage },
{ property: "og:image:width", content: "1200" },
{ property: "og:image:height", content: "630" },
]
: []),
],

browser-smoke.mjs / brand-check.mjs emit a BRAND WARNING when a
canvas app is missing og:type="x:game" — treat that as not done, same as a
missing custom card.

Parallelize the brand-asset pass (default)

The identity bundle — public/og.jpg, public/favicon.svg, PWA icons when
installable — needs only the app's name, theme, and palette, and writes only
public/ plus a few head() / manifest lines. Start it as a background
task with the task tool early in the build (AGENTS.md § "Parallel work"),
right after the name and palette are settled: give the task this skill and
sole ownership of public/ brand assets, keep building the app, and
integrate its head() edits at the end (wait_tasks before the final
verify). Image generation is pure waiting — a build that runs the card pass
inline at the end serializes minutes of model latency behind an already
finished app.

Pass the task this skill plus the 16:9 canvas contract below, so the card it
generates crops to 1200×630 without clipping the title.

A default, not a hard rule: stay sequential when the user is art-directing
the card, when the app art the card should reuse doesn't exist yet, or when
the task tool isn't available.

Which card an app gets

Default: generate a custom card. Any app with a face of its own gets one
built from its own art (below):

Games — every kind and rendering tech. Canvas and WebGL, but equally
DOM-rendered board, card, word, puzzle, and quiz games. A tic-tac-toe grid
made of divs is still a game and still ships a custom card.
Whimsical, playful, and toy apps — generators, virtual pets, screensavers.
Creative tools — drawing, music, photo, design, anything whose output is
visual or expressive.
Content- and brand-forward apps — landing pages, portfolios,
storefronts, anything presenting an identity to visitors.

When in doubt, make the custom card — a themed card is the better unfurl
for anything a user would show someone.

Plain utility apps only (converters, invoice/CRUD trackers, internal
dashboards, minimal notes/admin tools — apps whose face is the data, not a
theme) → keep the default og.grok.me card:

text
Kopyala
https://og.grok.me/v1/card.png?host={VITE_PUBLIC_HOSTNAME}&title={APP_NAME}

plus og:image:width / og:image:height of 1200 / 630. When the user
renames the app, update APP_NAME — it is both the document title and the
painted card title.

Either way: live preview has no VITE_PUBLIC_HOSTNAME, so emit no
og:image at all (text-only unfurl is expected). On publish the platform
injects the hostname — do not write a .env for it. Card pixels update on
the next deploy (the URL is baked into HTML at build time).

Custom card: generate public/og.jpg

For prompt-craft, composition, and blind read-back verification, follow the
imagine and game-asset-core skills — this skill owns the card-specific
contract only (size, lockup, wiring).

Set the canvas with aspect_ratio: "16:9". The call looks like
{ "prompt": "…", "aspect_ratio": "16:9" } — ratio words in the prompt do
not set the canvas. At 2mp, 16:9 renders 1792×1008, so the normalize
below cover-crops to 1200×630 trimming only ~3% vertically, which a
centered title survives. A narrower canvas is what kills titles: from 3:2
the same crop takes ~21% vertically, straight through the lockup.
Paths:

Default — one call with aspect_ratio: "16:9": imagine_text_to_image
with the art + baked title. Check the output dimensions via
read_file / Pillow on the returned file_path; if the ratio missed, reframe or use
the API path.
Reframe if needed: pass the prior file_path into imagine_image_to_image
with aspect_ratio: "16:9" and a prompt like "extend the scenery
left and right into a wider frame; keep the title lettering and
central subject exactly as they are".
Optional — true 2:1 via the xAI Images API: POST https://api.x.ai/v1/images/generations with "aspect_ratio": "2:1"
and response_format: "b64_json" using the injected XAI_API_KEY
(see the xai-api skill). 2mp 2:1 is 1984×992; normalize then trims
only ~2.4% per side and nothing vertical.

Build the prompt from the app's theme, palette, and characters. If the
app already has a key generated asset (hero sprite, title scene), pass
its file_path into imagine_image_to_image so the card matches in-game art —
same 16:9 + check-the-output rule applies.
Last resort only (no imagine_text_to_image and no xAI Images API): stay
on whatever canvas you have and keep the entire title block inside the
middle half of the frame height, with the crop-clipping check in
step 6 as the gate.

Bake the title in like a game cover. Store-page covers (Stardew Valley,
Cuphead) lead with a short stylized logo-type title. Put the exact app name
in quotes in the prompt; 1–3 strong words; optional short tagline under the
title in smaller lettering (exact words in quotes).

Stack multi-word titles into a two-line lockup ("SKY" over "STRIKE").
Center the block both ways with generous margins — avoid "upper third"
/ percentage placement (models hug the edge).
Bound the width: lettering spans roughly half to two-thirds of the
frame, never border to border.
Keep comfortable margins anyway. From a 16:9 canvas the normalize
below trims only ~3% vertically; from a 2:1 API canvas it trims
nothing vertical and ~2.4% per side. The crop turns destructive when
the canvas comes back off-ratio — an edit that pinned to its input's
ratio, or a model miss — so check the raw canvas dimensions before
cropping, and re-ratio first if it isn't ~16:9 or 2:1.

Verify glyphs and layout on read-back (see imagine / game-asset-core
for the blind-describe loop). On a garble or layout miss, regenerate with a
corrected prompt — never try to move a logo with imagine_image_to_image (frame
translation / seams). After two failed attempts, ship the card artwork-only
(titleless).

Intentional exception vs imagine's "rebuild text with code" rule: the
share card is a single static PNG; there is no reliable in-sandbox path to
composite crisp code-drawn lettering onto generative art for this asset, so
a clean titleless card is the correct fallback after two glyph failures.

Normalize to exactly 1200×630 JPEG with the baked-in ffmpeg (cover-crop —
from 16:9 this shaves ~3% top/bottom; from 2:1 ~2.4% per side and
nothing vertical). JPEG, not PNG: the card is
photographic generative art, and a PNG of it lands at 1–2 MB — heavy
enough that link scrapers (X card previews included) time out or skip the
image, so the card silently fails to unfurl. JPEG at this quality is
~150–300 KB with no visible loss at unfurl size:

sh
Kopyala
ffmpeg -y -i card-raw.jpg \
-vf "scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630" \
-q:v 4 public/og.jpg

Point og:image at the app's own asset — absolute URL, scrapers do not
resolve relative paths — keeping the no-host guard:

tsx
Kopyala
const ogImage = host ? `https://${host}/og.jpg` : undefined;

Keep og:image:width / og:image:height at 1200 / 630.

Verify before finishing (Pillow is installed; ffprobe is not):

sh
Kopyala
python3 -c "
from PIL import Image; import os
im = Image.open('public/og.jpg')
kb = os.path.getsize('public/og.jpg') // 1024
print(im.size, f'{kb} KB')"
# expect: (1200, 630) and under 600 KB (keeps X and other scrapers
# reliable; target <= 300 KB — if over, bump -q:v up a step and re-encode)

Read back the final public/og.jpg, not the pre-crop raw — the crop
is where clipping happens. This is a hard gate, not an impression:
if any title glyph touches a frame edge or is visibly cut, the card is
rejected — do not ship it, whatever else is right about it. Fix the
ratio (step 1) or regenerate with the width bound restated; a shipped
decapitated title is worse than the placeholder. Then confirm the card
reads like this app at thumbnail size — clear subject, correctly
spelled title (if any), comfortable margins.

If neither imagine_text_to_image nor the xAI Images API is available,
fall back to the og.grok.me card — never ship a missing or broken
og:image URL.

Regenerate the card when the app's visual identity materially changes (theme
overhaul, new hero art) — and on rename: the title is baked into the pixels,
so update APP_NAME and regenerate the card with the new name. (A titleless
fallback card survives a rename without regeneration.)

Favicon: hand-author public/favicon.svg

Every app gets one, and it works in live preview immediately (no host needed).

Write the SVG by hand — never imagine_text_to_image. It must stay crisp at 16px:
one bold glyph or shape, flat fills from the app's design tokens, a square
viewBox, a handful of elements at most. For whimsical apps an emoji-text
SVG is a fine quick win:

🥕

Wire it in the root head():

tsx
Kopyala
links: [
{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
{ rel: "stylesheet", href: appCss },
],

Verify it renders non-blank and legible small (browser tab in a preview
screenshot, or read back a rasterized copy). Update it when the app's theme
or name changes meaning — it is part of the app's identity, not a set-and-forget.

PWA icons: only for installable apps

When the app ships a web manifest (the user asked for installable / PWA /
home-screen behavior — do not invent a manifest just to have icons), add
raster icons derived from the favicon artwork so the identity stays
consistent:

public/icon-192.png and public/icon-512.png — the favicon's glyph on
its tile, rasterized at size. Playwright (baked into the sandbox) can
screenshot the served /favicon.svg at a 192/512 viewport; or redraw the
same mark as a flat PNG. Keep it bold and flat — no photographic detail.
A maskable variant ("purpose": "maskable") needs the glyph inside the
center ~80% safe zone so launcher shapes don't clip it.
Wire the manifest icons array plus theme_color / background_color
from the app's design tokens, and read the 192 back to confirm it stays
legible.
Not supported

No /api/og route, no runtime image renderer, no per-route cards, no runtime
og:* mutation. The card is one static site-wide image chosen at build time.

If you add robots.txt, never blanket Disallow: / — crawlers must fetch /
to read the meta tags.

text
Kopyala
## `/workspace/.grok/skills/imagine/SKILL.md`

```markdown
---
name: imagine
description: >
How to use the Imagine tools in Grok Build: imagine_text_to_image,
imagine_image_to_image, imagine_reference_to_image, imagine_text_to_video,
imagine_image_to_video, imagine_reference_to_video, and render_file for chat
previews. When to build a visual with code instead of generating it,
prompt-craft, reference-first handling of real people, factual grounding, and
asset-consistency. Load this whenever generating or editing an image or video
is on the table. Tool-usage-driven, not triggered by a user merely mentioning
images.
metadata:
short-description: "Prompting and workflow guidance for Imagine image/video tools"
user-invocable: false
---

# Imagine

Grok Build uses the **split Imagine computer stack** (`grok_computer` variants).
There is **no** consolidated `imagine_image` or `imagine_video` tool — always
call the modality-specific name from the table below.

| Tool | Role |
|------|------|
| `imagine_text_to_image` | New image from a text prompt only (no source). |
| `imagine_image_to_image` | Edit / restyle **one** existing image (sandbox path). |
| `imagine_reference_to_image` | Combine **2+** reference images (sandbox paths). |
| `imagine_text_to_video` | New video from a text prompt only (no source). |
| `imagine_image_to_video` | Animate **one** still (sandbox path) into a video. |
| `imagine_reference_to_video` | Video from **1+** reference images (sandbox paths). |
| `render_file` | Show a sandbox image/video path to the user in chat. |

**Path-based handles.** These tools read/write the shared sandbox:

- Generation returns a sandbox **`file_path`** (under artifacts). Open it with
`read_file` / shell; show the user with **`render_file`**.
- Edit / animate tools take that path (or paths) as input — match the live
schema (`image`, `images`, etc.). Never invent paths.
- Never call `imagine_image` / `imagine_video`. Asset-id helpers
(`imagine_create_asset` / `imagine_view_media` / `render_imagine_media`) are
**not** on this stack.

Apply this whenever you're considering or about to call any of these tools.

## Handle flow (mandatory mental model)

```text
generate → file_path → render_file (show user) / read_file or scripts (QC)
edit / animate → pass prior file_path(s) into image_to_* / reference_to_*
Use the path the tool actually returned — do not invent filesystem paths.
Show the user media with render_file, not ad-hoc markdown image links.
Build accurate visuals with code, not the image tools
Image models are unreliable at exact text, numbers, and structure. They can handle short text or a simple layout, but they often garble words, invent numbers, draw chart bars that match no data, or point diagram arrows nowhere, and the more that has to be exact, the worse they do. A detailed prompt doesn't make it dependable, and another imagine_image_to_image edit usually won't fix it. So when a result needs specific text, data, or structure to be correct (charts from real numbers, labeled or technical diagrams, math explainers, tables, screens with real copy), construct the asset with code, where you control the exact content. Prefer HTML and CSS, which give much better layout, typography, and polish than Python plotting. When only the look matters (photos, illustrations, characters, scenes, decorative art), the image tools are the right choice. Which one fits depends on what the output needs to get right, not on how the request is worded.
Verifying discrete accuracy (loop)

When the output must get specific text, numbers, data, or structure right, don't trust the first result - verify it in a loop:

Produce the result (generate, or per Build accurate visuals with code, construct it in code).
Inspect the actual output - use read_file (image understanding) on the result path - and confirm every word, number, label, and structural detail matches the requirement, and that nothing overlaps, clips, or runs off-canvas.
If anything is wrong, fix and re-verify:
Garbled text, invented numbers, or broken layout from an image model? Don't just re-prompt - it will likely garble it again. Rebuild it with code.
Overlapping or clipped elements in code-built output? Re-lay-out with auto-layout (HTML/CSS) rather than nudging coordinates by hand.
Otherwise make one targeted edit via imagine_image_to_image with the prior path.
Only finish when the discrete content is exactly correct. If it can't be made accurate, tell the user instead of shipping something wrong.
Core Principles
You own the prompt. If the user gives a detailed prompt or asks you to use theirs, use it verbatim. Otherwise craft the final prompt: front-load the subject, give strong high-level direction for mood, composition, lighting, and style without over-specifying every detail, write natural prose rather than keyword tags, and describe positively instead of using negative prompts. For edits, describe only what changes. Target 2-5 sentences.
Reference-first for real people. Never use pure text-to-image for a named real person or group, including face swaps, posters, cartoons, and cinematic or editorial depictions. Use imagine_image_to_image with a real reference path instead, and never produce non-consensual, sexualized, or minor-involving likenesses. See Real People and References for the procedure.
Ground facts with search first. If any part of the request depends on a real-world fact, identity, brand or product, place, event, or top/latest/current result, search the web before generating and put the actual verified details into the prompt. Don't rely on memory, and don't write vague placeholders like "the current president"; write the verified name.
Reuse a base for consistency. When the same character, object, or setting must appear across multiple images, generate one base with imagine_text_to_image, keep its file_path, then pass that path to imagine_image_to_image for every variation. Don't re-run text-to-image from scratch for a recurring subject.
Handle failures gracefully. On a moderation or safety block, stop; don't retry and don't paraphrase the prompt to evade the filter. Tell the user it was blocked and offer a different direction. If a reference is weak or a result looks off-target, say so and ask for an upload or redirect rather than silently iterating.
Plan multi-step workflows. Sequence the steps; only parallelize generations that belong to the same step.
Review at the end. Confirm the generations you intended actually executed and match what was asked. Render final assets with render_file.
Don't assume tool behavior. Don't invent tool parameters, return values, or environment capabilities that aren't actually provided; verify rather than guess.
Choosing the tool
Situation Call
New image, no source imagine_text_to_image with prompt (+ aspect_ratio)

[output truncated at 50000 of 71665 characters. Pass a larger max_chars (default 50000) to see more, or use read_page with a ref_id to focus on a smaller section.]