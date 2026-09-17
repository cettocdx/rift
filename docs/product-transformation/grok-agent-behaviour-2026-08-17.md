# Grok's agent behaviour, observed live

Captured 17 Aug 2026 from the user's own Grok account, conversation
`/c/a685adfe…` ("Orbital Gravity Simulator with Trails"), in Build mode.
Everything below is quoted or measured from that page, not recalled.

Two sources: the two finished turns already in the conversation, and one run
started during the session (`Add a small on-screen FPS and body-count readout`,
1m 2s) which was watched from submit to completion.

Status: observed, then applied — see **§9** for what landed and what did not.

## 1. The turn, end to end

A turn has exactly four regions, in this order:

1. The user's message — a right-aligned rounded pill.
2. The **work trace**. Expanded and streaming while the run is live; on
   completion it collapses into a one-line disclosure, `1m 2s saniye çalıştı`,
   with a `›` chevron. The cost of the work is stated before the work.
3. The **answer**.
4. An action row (copy, link, 👍, 👎, retry, ⋯) followed by follow-up
   suggestions, each prefixed `↳`.

## 2. The answer scales with the size of the change

This corrects the earlier reading, which generalised from one large build.

**Large build** — observed twice, `14m 4s` and `25m 11s`, with the same shape
both times:

1. One line of outcome. The opening sentence is a fixed template:

   > `<Name>` **is live in the preview —** `<one appositive clause saying what it is>`.

   > Apsis is live in the preview — a gravity sandbox where you throw worlds and watch them dance.
   > **Meridian** is live in the preview — a full-viewport night-and-day Earth with a thin atmosphere and a slow idle orbit.

   The name is bolded and comes first. No preamble, no restating the request,
   no "I've built you a…".
2. The generated hero image, inline.
3. **"Try this"** — imperative bullets, each a thing the reader can do in the
   next five seconds. **Bold marks the thing you touch** — the gesture, the
   control, the panel name:
   > **Drag** the globe to spin it. Orbit pauses while you do, then eases back.
   > **Click a light** on the surface, or a name in **Featured places**, and the camera settles on that meridian.
   > Open **Places** on a phone for the same list.
   > Use **Orbiting / Paused** if you want the spin to stay still.

   Mobile gets its own bullet when it differs.
4. One closing line carrying **whatever concrete fact the reader most needs.**
   This slot is not fixed. For the keyboard-driven sandbox it was a controls
   line:
   > Controls: scroll / pinch to zoom · right-drag or two-finger to pan · 1–5 mass · Space pause · C clear.

   For the pointer-driven globe, which has no shortcuts, it was the inventory:
   > Ten locations are marked: Reykjavík, Kyoto, Santorini, New York, Cape Town, Cusco, Singapore, Marrakech, Sydney, and El Chaltén.

**Small change** (`1m 2s`) — one sentence, nothing else:
> A small telemetry chip now sits in the top-left: live **FPS** and **body count**, updated as you fling and merge.

No "Try this", no controls line, no summary of what was edited. Key nouns are
bolded inline instead of broken out into a list.

**Medium change** (`1m 54s`) — outcome line plus one paragraph of detail:
> Collisions now hit with real sound.
> Each merge plays a layered impact — a short crack, a mass-weighted thud, and a faint ring — louder and deeper when something heavy swallows a fast inbound body.

The rule: **sections are earned, not templated.** Never open with intent or a
restatement of the request; never describe what was implemented when the reader
can just look at it.

## 3. Inside the trace

Observed structure, in order, from the `1m 54s` turn:

```
1m 54s saniye çalıştı  ⌄
  ◌ Adding collision sound effects                      ← phase title
  I'll check how collisions and audio are wired, then add punchier merge/impact sounds.
  ⌕ Keşfedildi  5 dosya, 1 arama                        ← activity
  Collision audio currently fires from a shake heuristic and a thin beep. I'll
  hook real merge events and layer a crack, thud, and ring that scale with mass.
  ✎ Edited 15 files
  ⌕ Aranan dosyalar için  playMerge                     ← mono argument
  ✎ Edited 3 files
  ▤ Dosya oku  types.ts
  ✎ Düzenlendi  audio.ts  +7 −1                         ← inline diffstat
  ▣ Komut çalıştırıldı  Typecheck after collision audio changes
  ▣ Komut çalıştırıldı  Trigger a collision and verify SFX hook
```

Three row kinds, and they alternate deliberately:

- **Phase title** — a gerund phrase naming the current stage of thinking
  ("Analyzing the current HUD implementation", "Planning the HUD overlay
  implementation").
- **Activity row** — `verb + argument`. The verb leads and is past tense once
  complete; the argument is de-emphasised. Arguments are **aggregated**, never
  one row per file: `Edited 15 files`, `5 dosya, 1 arama`.
- **Prose** — full-contrast, first person, and only at decision points: after
  exploring, stating what was found and what will therefore be done. Not after
  every tool call. This is the whole reason the trace is worth reading.

### The prose has one recurring shape

Every prose line is *next action + purpose clause in the reader's terms*:

> Checking the design and 3D skills first **so** the scene and overlay UI feel polished.
> Checking the scaffold, design tokens, and OG requirements next **so** the globe and overlay UI match the stack.

Or *what is now known, therefore what happens next*:

> Three.js isn't installed yet. I'll read the 3D and UI playbooks, then set up the globe scene.
> I have the stack and design direction. Installing Three.js, pulling Earth textures, and scaffolding the app in parallel.
> Collision audio currently fires from a shake heuristic and a thin beep. I'll hook real merge events and layer a crack, thud, and ring.

Never "I will now use the X tool". The tool is invisible; the *reason* is the
content. Parallelism is stated plainly when it happens ("in parallel").

### Skills are announced twice, and neither is a callout

Observed on the 3D globe run. A skill load appears as an ordinary activity row —
same muted register, same 14px icon (whose id in Grok's icon set is literally
`skills`), aggregated count:

```
⛭ 3 beceri yüklendi
⛭ 1 beceri yüklendi
```

There is no banner, no badge, no colour. But the prose *around* it does the
work, before and after:

> Checking the design and 3D skills first so the scene and overlay UI feel polished.
> Three.js isn't installed yet. I'll read the 3D and UI playbooks, then set up the globe scene.

Two things to copy:

- Skills load **on demand throughout the run**, not once at the start. On the
  globe run they interleaved with exploration: read 2 files → load 1 → search →
  load 1 → read → load 1. Six loads across the first two minutes.
- In prose they are called **"playbooks"** and are described by what they buy
  the reader. The word "skill" appears only in the terse row.

Two details worth copying:

- **Commands are described by intent, not by the command string.** The row reads
  `Komut çalıştırıldı · Typecheck after collision audio changes`, never
  `pnpm typecheck`. The argument is a human sentence explaining *why*.
- **Rows are individually expandable** — hovering swaps the leading icon for a
  `›` chevron and brightens the whole row.

## 4. Measured styling

All values read from computed style on the live page. Font is `universalSans`.

| Element | Size / line-height | Weight | Colour |
| --- | --- | --- | --- |
| Activity verb | 14px / 24px | 400 | `rgb(158,158,158)` (secondary) |
| Activity argument | 14px / 19.25px | 400 | `rgb(133,133,133)` (tertiary) |
| Mono argument | 13px / 24px | 400 mono | `rgb(133,133,133)` |
| Phase title | 14px / 24px | 400 | `rgb(158,158,158)` |
| Answer prose | 15px / 22.5px | 400 | `rgb(252,252,252)` |
| Diff added | 14px | 400 | `rgb(0,179,48)` |

Letter-spacing is `-0.1px` throughout.

Geometry:

- Row height **24px**, row pitch **32px** — an 8px gap between rows.
- Icons **14×14, stroke-width 1**, same colour as the verb.
- Verb and argument sit on a `flex items-baseline` row with a **6px** gap —
  baseline, not centre.
- Icon left edge to verb text: **~11px**.
- A **1×5px connector tick** at 20% white sits in the 8px gap, on the icon's
  centre line — a dashed thread down the icon column, not a continuous rail.
- Prose paragraphs align to the **icon** column, outdented ~26px from the verb.

Hover: the row is a `group`, and hovering promotes the verb to primary and the
argument to secondary. The brightening is a colour transition only.

## 5. Motion

Two animations, both measured off the live run:

**In-progress rows shimmer.** A gradient sweeps across the text via
`background-clip: text`:

```css
background-image: linear-gradient(100deg,
  #858585 0%,  #858585 28%,
  #989898 42%, #b7b7b7 52%, #e2e2e2 58%,
  #fcfcfc 61%,                       /* highlight peak */
  #858585 66%, #858585 100%);
background-size: 200%;
background-clip: text;
color: transparent;
/* keyframes: background-position-x 200% → -200% */
animation: shimmer-text-sweep 2400ms linear infinite;
```

The ramp is asymmetric — a long rise from 28% to the 61% peak, then a sharp fall
by 66%. It reads as a light source passing behind the text, not a pulse.

**Text arrives word by word.** Each word is its own element with a `gaussian`
animation, **100ms, ease-in-out, one iteration**. Words fade in individually as
they stream rather than the paragraph appearing at once.

## 6. Live-run surface

There is **no separate activity panel**. While the run is live the trace streams
inline, in the exact place it will later collapse into. Nothing moves when the
run finishes except the collapse itself.

Sequence observed from submit:

```
▭ Bilgisayara bağlandı              ← environment ready, first row
◌ Analyzing the current HUD implementation
I'll add a compact FPS and body-count readout to the top-left, matching the existing HUD.
▤ 1 dosya okundu
◌ Planning the HUD overlay implementation
⌕ Keşfedildi  3 dosya, 1 arama
✎ Editing 9 files                   ← present participle + shimmer
▣ Komut çalıştırıldı  Ensure preview server is still up
⣿ Çalışma aşaması için 53s          ← live ticker, always last
```

Three rules fall out of this:

- **Tense encodes state.** `Editing 9 files` while running becomes
  `Edited 9 files` when done. The row does not change shape, only tense — and
  the shimmer stops.
- **The ticker is pinned to the bottom** and names the current phase plus
  elapsed seconds, counting up live.
- The trace container **follows the newest row**; older rows scroll off.
- The preview pane updates **during** the run, not at the end.

### The preview pane is a second, one-line status surface

While the app is not yet renderable, the preview pane does not show a spinner.
It shows **one human-readable line naming the current action**, centred, over an
animated perspective grid:

```
Browsing files
Reading animations.md
Reading 12c64960-2a2f-4b75-a34a-8f6975bcbfac.jpg
```

That line is a headline — "what is happening right now" — deliberately distinct
from the scrolling trace, which is the history. When it changes, only the
changed tail blurs in; the shared prefix stays put.

Behind it, a perspective grid recedes to a vanishing point. Coloured light beams
sweep along the grid lines and fade out again on a slow cycle — checked across
several minutes, they come and go rather than building steadily. Long, quiet,
and non-repetitive enough not to read as a spinner.

### Artifacts appear inline, mid-run

On the globe run, at ~3m, a generated hero image appeared **inside the
conversation column**, in a rounded full-width frame, before any answer text:
a night-side Earth captioned `MERIDIAN` / *Places worth facing*.

So the agent invents a product name and tagline, generates the brand asset as a
real file, and shows it the moment it exists — the same instinct as naming the
gravity sandbox "Apsis". Naming happens **during** the run, not in the summary.

## 7. Why the output is good — the visual self-verification loop

This is the most valuable thing observed, and it is a *behaviour*, not a style.
From the 3D globe run, in order:

```
▣ Komut çalıştırıldı  Start the Vite preview server on 8080
▣ Komut çalıştırıldı  Check if dev server is up and read logs
▣ Komut çalıştırıldı  Wait for Vite to become ready
▣ Komut çalıştırıldı  Run browser smoke test and capture screenshot
▣ 1 görsel görüntülendi          ← it looks at its own screenshot
✎ Edited 1 file                  ← and fixes what it saw
The globe is rendering. Next I'll frame it beside the list, keep marker clicks
from canceling focus, and brighten the scene.
✎ Edited 6 files
▣ Komut çalıştırılıyor  Interact with globe: focus, drag, mobile
▣ 4 görsel görüntülendi          ← one screenshot per interaction state
```

The agent boots its own app, drives its interactions (including mobile),
screenshots each state, **reads the screenshots back**, and edits from what it
saw. "Brighten the scene" is a taste judgment that cannot be derived from source
— only from looking at the render. The brightening landed live in the preview
mid-run and was visibly correct.

It also verifies the **production** build, not just the dev preview, and chased
a real discrepancy between them for several minutes:

```
▣ Komut çalıştırıldı  Build production app for Vercel deploy
▣ Komut çalıştırıldı  Serve production build on port 4173
Vite preview doesn't match the Vercel output. I'll serve the static build and
check that assets load with the right MIME types.
▣ Komut çalıştırıldı  Inspect Vercel static build output structure
▣ Komut çalıştırıldı  Find how production HTML references built assets
▣ Komut çalıştırıldı  Inspect client boot and Nitro server function
⌕ 1 arama çalıştırıldı            ← a web search, mid-run, to solve it
▣ Komut çalıştırıldı  Verify asset import paths and keep dev server up
```

"It works in dev" is not accepted as done. Note also that a **web search** is
just another activity row when the agent gets stuck.

Related habits from the same run:

- **It fixes its own bugs without apology or ceremony.** The one self-correction
  read: *"Fixing the loader so it doesn't stick on a blank curtain, then
  starting the preview."* Stated as the symptom the user would see, not the
  technical cause; no "I made a mistake"; the sentence continues straight into
  the next step.
- **It does unrequested production work.** Nobody asked for a social preview
  card, yet: `Komut çalıştırıldı · Normalize OG card to 1200x630 JPEG`.
- **Demo content is written, not filled.** The featured location reads
  *"Whitewashed towns cling to the cliff of a drowned volcano, facing a
  wine-dark circle of sea."* — real editorial copy with a Homeric allusion, not
  lorem ipsum and not a flat factual gloss.
- **It names and brands the artifact during the run**, then generates the brand
  asset: `MERIDIAN` / *Places worth facing*, in two composition variants, shown
  inline before any answer text.

## 8. What to apply to RIFT

Reasoning style:

- Report elapsed work time on the turn, as a disclosure that opens the trace.
- Open with the outcome in one sentence, naming the artifact. Never with intent.
- Earn each further section. Small change → one sentence and stop.
- Prose in the trace only at decision points: what was found, therefore what
  will be done. Not narration of every call.
- Every prose line: next action + purpose clause in the reader's terms.
- Describe commands by intent, never by the command string.
- Aggregate counts; never one row per file.
- Self-corrections stated as the symptom the reader would see, without apology,
  continuing straight into the next step.

Behaviour — the part that actually moves output quality:

- Boot the thing, drive its interactions, screenshot each state, **read the
  screenshots back**, and fix what you saw. Re-check after the fix.
- Verify the production build, not only the dev server.
- Name the artifact during the run and give it a real identity.
- Write demo content; never leave placeholder copy.
- Do the unglamorous production work nobody asked for (share cards, mobile).

Agent Activity surface:

- Stream inline where the collapsed trace will live; do not move on completion.
- Two registers only: muted activity rows and full-contrast prose.
- 24px rows on a 32px pitch, 14px icons at stroke 1, 1×5px connector ticks.
- Verb past tense when done, present participle plus shimmer while running.
- Pin a live ticker naming the current phase and elapsed time.

## 9. What was applied

### The trace surface

`lib/ui/workspace-chrome.ts` now carries the measured row tokens, and both the
product panel (`AgentActivityPanel`) and the landing replica (`HeroWorkspace`)
render from them, so the two cannot drift. Rows are 24px on a 32px pitch, icons
14px at stroke 1 in the verb's own colour, verb and argument on a shared
baseline 6px apart, a 1×5px connector tick between rows.

Three things were **removed**, and their absence is the point:

- the zero-padded step number trailing every row — nobody counts operations;
- the check/cross status column — status is the verb's tense plus the sweep;
- the row borders — the connector tick carries continuity instead.

`getActionText` already switched tense on execution state, which is Grok's rule
exactly; its completed labels were trimmed from "Successfully wrote" to "Wrote".
The in-progress verb takes `.rift-thinking-shimmer`, retuned in `globals.css`
from a symmetric pulse to the measured asymmetric sweep. A live row is pinned to
the foot of the trace carrying the current phase and elapsed time.

Locked by `cursor-text-hierarchy-contract.test.ts`.

### The answer and narration contract

`lib/system-prompt.ts`: Build mode gained `<answer_contract>` and `<naming>`;
the default agent path's `<summary_spec>` was rewritten from "summarize any
changes you made at a high-level" to outcome-first, and both paths gained the
decision-point narration rule. Locked by `lib/__tests__/system-prompt.test.ts`.

### The visual self-verification loop

This was the gap, and it was a code gap rather than a prompt one. `verify_app`
rendered the app in Chromium but only ever read DOM metrics — element counts,
text length, overflow. It could prove the page was not blank. It could not see
that the globe was clipped on the right.

`verify_app` now screenshots both viewports and returns them to the model
through `toModelOutput`. The frames never enter the persisted tool result: they
are held in a small module-level cache between `execute` and `toModelOutput`
and dropped on read, so the model looks once, at the step where it matters, and
replayed history stays text. The Build workflow step is now
`VERIFY → LOOK → REPAIR → PREVIEW`, and the gate is "`ok: true` **and** the
frames look right".

### The playbook system (second pass — the part the first pass missed)

Grok's expanded trace named its skills: `building-games`, `design-ui`,
`threejs`, `og`, `imagine`, `auth` — six loads across one run, matched to the
task, none of them asked about. RIFT had the machinery (`find_skills`, two
frontend quality profiles, deterministic matching) but the policy forbade the
agent from ever calling it unprompted, so no build ever loaded anything.

Applied, at the owner's explicit direction:

- **Policy flipped.** `<skills>` now reads "loading them is YOUR job, not the
  user's": every Build opens with `find_skills` (workflow step 0), and the
  agent calls it again mid-run when the work enters a new domain. The
  suggestion reminder and tool description flipped to match. User-enabled
  skills are untouched — they inject as before.
- **Three playbooks written**, mirroring Grok's set: `threejs-scene`
  (renderer/lighting/camera-motion craft), `og-share-card` (real 1200×630
  share image + full meta, done unprompted), `brand-identity` (name, tagline,
  wordmark, hero asset via `generate_image`, product-voice copy everywhere).
  With the existing profiles: `ui-ux-pro-max` + `design-taste-frontend` ≈
  design-ui, `browser-game` ≈ building-games, `og-share-card` ≈ og,
  `brand-identity` ≈ imagine.
- **The frontend gate was blind to visual builds** — "Build a rotating 3D
  globe…" matched no token, so exactly the tasks that need the quality packs
  most loaded nothing. The term set now covers 3d/webgl/canvas/game/scene/
  globe/simulation and friends, and the quality set includes the two
  finish-line packs.
- The `find_skills` call already renders as a trace row ("Loaded … · …") via
  its tool handler, which is Grok's `Beceri yüklendi` row.

### Not applied at the time

- **The one-line "what is happening right now" headline over the preview pane.**
  RIFT's trace already streams inline; adding a second live surface is a design
  decision, not a transcription, and belongs with the workbench work.
- **Per-word text reveal** (`gaussian`, 100ms). Measured and recorded above;
  applying it means touching the streaming markdown renderer, which is a
  separate change with its own performance question.

Both have since landed — see **§11**. This list is kept as written so the
sequence stays legible.

## 10. Third pass — the skills themselves, and the surfaces

Grok printed its own skill tree verbatim when asked (saved in full to
`grok-skills-dump-2026-08-17.md`): 18 SKILL.md packs + a reference library
(`design-ui` alone carries references for animations, performance, refined-ui,
surfaces, typography; `building-games` carries per-genre playbooks). The loaded
set's contents were ported into RIFT's catalog, adapted to RIFT's tools:

- `design-taste-frontend` now carries Grok's design-ui core: design-system-first
  tokens under `@theme`, the ban on ad-hoc hex/arbitrary values, the quantified
  rubric (≤3-5 colors, ≤2 fonts, 4/8 spacing, 44px targets, mobile-first at
  390px), the anti-slop tell list, the v4 button-cursor fix, and the finish
  checklist ending in "rendered and eyeballed in a browser, not just curl".
- `browser-game` now carries building-games' correctness core: RAF-only timing,
  delta scaling with a 0.1s cap, fixed-timestep physics, `THREE.Timer` over
  `Clock`, the inverted-A/D steer trap with the exact sign convention, the
  meshes-face-+Z/cameras-look--Z orientation gotchas, and "verify by PLAYING it".
- `og-share-card` gained their size contract (≤600KB, target ≤300KB), the
  width/height meta pair, extend-never-replace-the-head, and custom-cards-by-
  default for anything with a face.
- `brand-identity` gained imagine's asset discipline: 2-5 sentence prose
  prompts, front-loaded subject; exact text/data/structure gets BUILT WITH CODE
  because image models garble it; generated output is verified by looking at it.

And the surfaces, same session:

- **Conversation typography is Grok's measured set**: everything at 15px/22.5
  (−0.1px tracking, weight 400, bold 550) via `.rift-conversation-prose`
  (Geist standing in for their proprietary universalSans); the user's message
  is their right-aligned pill (24px radius, 8px bottom-right, 8×16 padding,
  576px cap) instead of the old terminal echo.
- **The inline trace renders in Grok's grammar** (`AgentTrace`): decision-point
  prose + verb-and-intent activity rows with connector ticks, tool cards gone
  from the transcript; evidence stays in the Agent Activity panel.
- **The live preview takes the Agent Activity slot automatically** the moment
  `expose_preview` returns a URL — a chat-level watcher opens it without
  depending on the inline card's mount.

## 11. Fourth pass — the delegated skill, and the two deferred animations

### `controls`, the pack the games playbook refuses to be

Grok's `building-games` will not answer a steering question itself. §2 of it
reads: *"Open `.grok/skills/controls/SKILL.md` before implementing any WASD /
steer / flight code"*, and then, in case the reader thinks racing covers it:
*"Do not treat `genres/racing-kart.md` as the only place steer signs live —
planes, jetskis, and mechs never open it."*

The third pass ported the reminder into `browser-game` as one paragraph and
stopped there, which left RIFT holding a warning with nothing behind it. The
paragraph could state the convention but not the twenty other things that make
input correct, and on any non-racing task — a flight sim, a boat, a mech — the
agent had no playbook at all for the highest-frequency bug in the genre.

`controls` now exists as its own catalog pack (`lib/ai/skills/catalog.ts`),
covering what Grok's file says its own does, plus the parts `building-games`
§2 and §4 spell out in passing:

- **The rule, stated as the reader's experience, not the maths**: pressing A
  turns the vehicle LEFT ON SCREEN while moving forward behind a chase camera.
  Everything else is derivation.
- **The sign convention once**: with `forward = (-sin(yaw), 0, -cos(yaw))`,
  `KeyA → steer = +1` and `yaw += steer * turnRate * speedFactor * dt`. The
  shipped bug — `KeyA → steer = -1` — is named as the bug it is.
- **Strafe is not steer**, per genre: shooters strafe on A/D and yaw from the
  mouse; vehicles steer with turn rate scaled by speed; tanks rotate the hull;
  fixed-wing A/D are *ailerons* (roll turns you); heli/drone A/D is lateral
  cyclic with yaw on its own keys.
- **The plumbing that reads as "laggy" when wrong**: held-key state consumed by
  `dt` rather than keydown-driven movement, normalized diagonals, key map reset
  on blur and pointer-lock exit, `event.code` not `event.key` (AZERTY), and
  `preventDefault` on the keys you own.
- **Pointer lock is look-only**, from a click-to-play gesture, pitch clamped
  under ±90°.
- **The camera must agree**: a dedicated `moveForward`/`moveRight` computed once
  and never aliased by camera code — Grok records this as a real repro bug.
- **The mandatory self-test**, which is the whole reason the pack exists:
  expose `window.__controlsTest` and actually drive. A still frame of a car that
  steers backwards looks perfect, so screenshot verification cannot reach this
  class of bug — the same argument §7 makes for looking at renders, one level
  further in.

`browser-game`'s paragraph became a delegation in Grok's own words, and the
discovery vocabulary covers what the racing genre file never sees: flight,
plane, drone, helicopter, tank, jetski, boat, pointer lock, first person, plus
the Turkish terms. Locked by `lib/ai/tools/__tests__/find-skills.test.ts`.

### Both deferred animations

The preview headline turned out to be **already built** — `BuildPreviewPanel`
takes a `statusLine`, `chat.tsx` derives it from
`buildLiveProgressPresentation`, and it renders over `PreviewIdleGrid` while
the run is still building. §9's note was stale.

The per-word reveal is now real, and it cost less than the deferral assumed:
Streamdown ships an animate plugin that splits text nodes into
`[data-sd-animate]` word spans, so nothing about the renderer had to be
rewritten. The measured values go in as measured — `gaussian`, 100ms,
ease-in-out, one iteration, word separator — with the keyframes ours, since
the plugin emits the custom properties but no curve. The name is honoured
literally: a gaussian arrival is opacity plus a short blur settling out.

Two decisions the observation did not dictate:

- **Stagger 24ms.** Grok's measurement records no stagger; their token stream
  supplies the rhythm. RIFT's stream can deliver several words in one frame, so
  without a small stagger "word by word" degrades to a clump fading in together
  — the exact thing the animation exists to avoid.
- **Off once the message is finished.** The spans exist to carry one 100ms
  animation; keeping thousands alive down a long transcript pays DOM for a
  frame nobody will see again. `revealWords` follows `isStreaming`, so a
  completed answer renders as plain markdown.

Reduced motion drops the animation, never the text. Locked by
`app/components/__tests__/word-reveal-contract.test.ts`.

### What the live run found

Verification was a real Build on 18 Aug 2026 — *"WASD ile sürülen, chase
kameralı bir araba yarışı oyunu yap."* — watched from submit to answer.

The trace read exactly as Grok's does: cost-first disclosure (`Worked for 20s`),
decision-point prose in the reader's terms, present-participle rows with a
pinned ticker, a self-correction stated as symptom ("Vite eklentisinin en yeni
sürümü mevcut Vite 6 ile eşleşmedi; uyumlu sürümü sabitleyip…") and no apology.
It named the product KOR, generated a hero image inline mid-run, `Viewed og.jpg`
its own card, verified the production build, and — the point of the new pack —
wrote and ran `scripts/playtest.mjs`, announcing *"gerçek sürüş yönlerini
tarayıcıda ölçerek doğrulayacağım"*. The agent's own opening line asked for
"oyun ile kontrol playbook'ları". `controls` loaded.

It also exposed a real defect, which is why the run was worth its cost.

**Turkish inflection had left the catalog largely dead.** The trace read
`Loaded 1 skill`. `controls` matched on the bare loanword `wasd`; nothing else
matched at all. Turkish is agglutinative and the bare stem rarely survives into
a sentence: `oyun` arrives as `oyunu`, `sayfa` as `sayfası`, `küre` as `küreyi`.
Matching was exact-token, so a request that is nothing but a game loaded neither
the game playbook nor a single quality pack — on precisely the task they exist
for. §10 had added Turkish stems; stems were never the form users type.

`tokenMatchesTerm` now allows a bounded suffix (terms of 4+ characters, up to 4
trailing characters). It is deliberately crude — no stemmer, no word list — and
it admits a few false positives ("kartal" hits "kart"). The trade runs the right
way: a spurious match costs one extra playbook in context; a miss costs the
whole quality set. Locked by `find-skills.test.ts`.

### The preview and Agent Activity are one pane, and now say so

The same run surfaced a second gap, from the owner directly: the preview took
the Agent Activity slot the moment `expose_preview` returned a URL (§10), and
nothing brought it back. Two messages in the live conversation read "preview ac"
and "nerde acık prewiev".

Each surface now carries the button that reaches the other: a window icon in the
Agent Activity header when there is a preview to show, and a list icon in the
preview chrome that returns. Leaving the preview re-opens the pane it shares
rather than emptying it — the old control set `buildPreviewOpen` false and, with
the sidebar shut, the whole pane simply vanished. Wired on mobile too. Locked by
`preview-activity-toggle.test.ts`.

### Two defects found alongside, unrelated to the Grok work

- **Included credits always read "0 credits left".** The sidebar said "Max"
  while the card beneath it said zero. Only the upgrade flow writes
  `mock_subscription_tier`, so a mock-billing session that never passed through
  it sent no tier to Convex; with no real subscription row either, the server
  resolved the allowance for tier `""`, which falls through
  `INCLUDED_CREDITS_BY_TIER` to 0. The usage surfaces now pass the plan they are
  already displaying. With the plan resolving, the card reads 1.8M used of 1.8M
  — the allowance really is spent, which is what it should have said all along.
- **`generate_video` rejected valid calls.** A complete shot-ready call failed
  schema validation on a missing `brief` — a caption for the rendering
  placeholder that `execute` never reads and the client already normalises away.
  One absent word threw away the whole generation. `brief` is optional now, on
  both the video and image tools.

## 12. Fifth pass — the detail the summaries dropped

Earlier passes took the *core* of each printed skill file. Re-reading them
whole, what had been summarised away was mostly the specifics — and the
specifics are the part that names a failure the model would otherwise walk
into from memory.

- **`threejs-scene` now kills the CDN era by name.** Grok's threejs pack exists
  "so the agent can generate correct modern three.js without inventing outdated
  CDN/r128 APIs" — that is its stated purpose, and RIFT's version had no trace
  of it. A model asked for three.js reaches for an `importmap` and a pinned
  `r128` build, which looks right and leaves the production build with no three
  at all. The pack now says: install from npm, no importmap, no cdnjs, no r128;
  prefer R3F + drei in React (`dpr={[1, 2]}` is the pixel-ratio cap there); and
  check before finishing that every import resolves and no script tag survived.
- **`design-taste-frontend` names its libraries.** "Use a real icon set" is
  advice; `lucide-react` is a decision. Same for `recharts` and for shadcn/ui
  (Radix + cva + tailwind-merge) instead of hand-rolled dialogs. Plus the small
  trap Grok records and RIFT had lost: canvas images need
  `crossOrigin="anonymous"` or the first read taints the canvas.
- **The canvas/overlay seam is explicit.** Grok's design-ui hands the gameplay
  canvas to building-games and governs only the DOM over it, with the overlay
  kept legible and — the part that matters — out of the gameplay input path. An
  overlay that swallows a pointer-lock click breaks the game without looking
  broken.
- **`og-share-card` covers installable apps.** An SVG favicon, and a manifest
  with 192/512 and maskable icons when the thing is worth keeping on a home
  screen.

### Deliberately not ported

`og:type = x:game`. Grok sets it on every game and documents it as "a product
contract with X's card pipeline" for `*.grok.me` unfurls. Whether X treats an
app published from RIFT the same way is unverified, and shipping a meta tag on
the strength of someone else's private arrangement is how cargo cults start.
Locked as an absence by `ported-playbook-depth.test.ts`, so a later pass does
not quietly add it.

### What is still not ported, and why

The dump lists 18 skill packs and a reference library, but Grok printed the
*contents* of only the six it loaded that run — and `auth` was truncated
mid-file. Everything else (`controls` aside, which its own delegation described
well enough to rebuild) exists in the dump as a filename. Porting
`neon`, `multiplayer-p2p`, `xai-api`, the game-asset chain, or the
`design-ui`/`building-games` reference files would mean writing them from
imagination and attributing them to Grok. The honest state is: the loaded set
is ported to its depth, and the rest is a list of names.

