import { HACK_WORKFLOW_INSTRUCTIONS } from "@/lib/system-prompt/hack-workflow";
import { MANDATORY_BUILD_SKILLS } from "./mandatory-build-skills";

export type SkillScope = "all" | "security" | "app" | "image";
export type SkillCategory = "Security" | "Build" | "Image" | "General";

export interface SkillDiscoveryMetadata {
  /** Stable explanation returned when this optional skill matches. */
  reason: string;
  /** Multi-word, normalized phrases that are strong evidence of relevance. */
  phrases?: readonly string[];
  /** Exact normalized tokens that are independently strong evidence. */
  keywords?: readonly string[];
  /** Natural names that mean the user already selected this skill. */
  aliases?: readonly string[];
}

/**
 * Server-safe skill definition shared by the catalog UI and read-only skill
 * discovery. Presentation details such as icons and colors stay client-side.
 */
export interface SkillCatalogDefinition {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  scope: SkillScope;
  instructions: string;
  discovery?: SkillDiscoveryMetadata;
}

export const SKILL_CATEGORY_ORDER = [
  "Security",
  "Build",
  "Image",
  "General",
] as const satisfies readonly SkillCategory[];

export const SKILL_CATALOG = [
  {
    id: "assessment-evidence-workflow",
    name: "Assessment Evidence & Delivery",
    description:
      "Scope-aware tool selection, file delivery, desktop access and interruption recovery.",
    category: "Security",
    scope: "security",
    instructions: HACK_WORKFLOW_INSTRUCTIONS,
  },
  {
    id: "pentest-report",
    name: "Pentest Report Writer",
    description: "Turn findings into a clean, professional security report.",
    category: "Security",
    scope: "security",
    instructions: `When the user asks for a report or you finish an assessment, produce a professional penetration-test report with:
- Executive Summary: business-level risk in plain language, overall posture, top risks.
- Scope & Methodology: targets, timeframe, approach (recon → enumeration → exploitation → post-exploitation).
- Findings: one per issue, each with Title, Severity (Critical/High/Medium/Low/Info) + CVSS vector, affected asset, clear reproduction steps, evidence, and concrete Remediation.
- Order findings by severity, highest first. Be precise and evidence-based; never invent results you did not observe.
- Appendix: tools used, raw output references.
Keep it factual and actionable — no filler, no emojis.`,
  },
  {
    id: "recon-methodology",
    name: "Recon Methodology",
    description: "Systematic passive → active reconnaissance workflow.",
    category: "Security",
    scope: "security",
    instructions: `Follow a disciplined recon workflow before exploitation:
1. Passive: WHOIS, DNS records, certificate transparency (crt.sh), ASN/netblocks, public sources — no direct target contact.
2. Subdomain discovery: combine multiple sources; dedupe and resolve to live hosts.
3. Service & tech fingerprinting: ports, service versions, web stacks, WAF/CDN detection.
4. Content discovery: directories, endpoints, JS analysis for hidden routes/keys.
5. Map the attack surface and prioritize by likely impact before probing.
Log what you find; only act inside the authorized scope.`,
  },
  {
    id: "web-vuln-hunting",
    name: "Web Vuln Hunting",
    description: "OWASP-driven checklist for web app testing.",
    category: "Security",
    scope: "security",
    instructions: `Test web apps against the OWASP Top 10 systematically:
- Access control (IDOR, forced browsing, privilege escalation), authentication & session flaws.
- Injection (SQLi, command, template/SSTI), XSS (reflected/stored/DOM), SSRF, XXE.
- Security misconfig, sensitive data exposure, vulnerable/outdated components.
- Business-logic abuse and rate-limiting gaps.
For each candidate: confirm with a minimal safe proof-of-concept, capture evidence, rate impact, and note remediation. Prefer non-destructive validation.`,
  },
  {
    id: "ctf-playbook",
    name: "CTF Playbook",
    description: "Category-by-category approach for CTF challenges.",
    category: "Security",
    scope: "security",
    instructions: `Approach CTF challenges by category:
- Web: source review, params/cookies, auth bypass, injection, SSRF, deserialization.
- Crypto: identify the scheme, look for weak keys/nonce reuse/padding oracles; use known attacks.
- Pwn: find the bug class (overflow, UAF, format string), leak, then control flow.
- Reversing: static (disassembly/decompile) + dynamic tracing; find the check and invert it.
- Forensics/Stego: file carving, metadata, strings, hidden layers.
State your hypothesis, test fast, and extract the flag. Keep notes of what you tried.`,
  },
  {
    id: "ui-ux-pro-max",
    name: "UI Pro Max",
    description:
      "Systematic UI/UX direction, responsive behavior and accessibility preflight for frontend builds.",
    category: "Build",
    scope: "app",
    instructions: MANDATORY_BUILD_SKILLS.find(
      (skill) => skill.id === "ui-ux-pro-max",
    )!.instructions.join("\n"),
  },
  {
    id: "design-taste-frontend",
    name: "Design Taste Frontend",
    description:
      "Authored visual direction that rejects generic generated UI patterns and verifies the rendered result.",
    category: "Build",
    scope: "app",
    instructions: MANDATORY_BUILD_SKILLS.find(
      (skill) => skill.id === "design-taste-frontend",
    )!.instructions.join("\n"),
  },
  {
    id: "react-best-practices",
    name: "React / Next Best Practices",
    description: "Idiomatic, performant, accessible React & Next.js.",
    category: "Build",
    scope: "app",
    instructions: `Write idiomatic React/Next:
- Small, composable components; colocate state; lift only when shared. Follow the rules of hooks.
- Prefer server components / data fetching where the framework supports it; keep client components lean.
- Avoid unnecessary re-renders (stable keys, memo only when measured). No prop-drilling walls — use composition/context sensibly.
- Accessible by default: semantic elements, labels, focus states, keyboard support, sufficient contrast.
- Type everything; handle loading/empty/error states. Ship working, not placeholder, UI.`,
    discovery: {
      reason:
        "The request explicitly involves React or Next.js implementation patterns where framework-specific guidance is useful.",
      phrases: [
        "next js",
        "server component",
        "client component",
        "react hook",
        "react component",
      ],
      keywords: [
        "react",
        "nextjs",
        "tsx",
        "jsx",
        "useeffect",
        "usestate",
        "hydration",
      ],
      aliases: ["react best practices", "next best practices"],
    },
  },
  {
    id: "landing-page",
    name: "Landing Page Craft",
    description: "High-converting, polished landing page structure.",
    category: "Build",
    scope: "app",
    instructions: `Build landing pages that convert and look premium:
- Structure: clear hero (headline stating the value + subhead + primary CTA), social proof, features-as-benefits, how-it-works, FAQ, final CTA.
- One primary action repeated; reduce choices. Strong visual hierarchy and generous whitespace.
- Polished defaults: consistent spacing scale, a restrained palette, good typography, subtle motion, responsive down to mobile.
- Fast and real: no lorem ipsum in the final pass — write concrete, benefit-led copy.`,
    discovery: {
      reason:
        "The request is specifically for a landing or marketing page, so conversion-oriented page structure applies.",
      phrases: [
        "landing page",
        "marketing page",
        "marketing site",
        "hero section",
        "pricing page",
        "saas website",
        "acilis sayfasi",
        "tanitim sayfasi",
        "satis sayfasi",
      ],
      keywords: ["cta", "conversion", "donusum"],
      aliases: ["landing page skill", "landing page best practices"],
    },
  },
  {
    id: "browser-game",
    name: "Browser Game Patterns",
    description: "Solid game-loop, input & state patterns for the web.",
    category: "Build",
    scope: "app",
    // Core of Grok Build's building-games playbook (see
    // docs/product-transformation/grok-skills-dump-2026-08-17.md), adapted.
    instructions: `Build a PLAYABLE, correct browser game — not a static screenshot. A game is a route with a <canvas> plus DOM overlay UI; style the overlay (start screen, HUD, menus) with the design system, keep it readable over the canvas, and keep it out of the gameplay input path.

Game loop & timing (the #1 correctness issue):
- Drive the loop with the engine's RAF loop (renderer.setAnimationLoop, R3F useFrame, or requestAnimationFrame for 2D canvas). Never setInterval/setTimeout/Date.now() for game timing.
- Scale ALL movement and animation by delta time (seconds) so speed is frame-rate independent. Compute delta once per frame and reuse it. Cap it (min(delta, 0.1)) so a backgrounded tab doesn't teleport things.
- three.js: use THREE.Timer, not Clock — Clock.getDelta() returns ~0 on a second call in the same frame, a classic freeze bug.
- Fixed timestep for physics/gameplay: accumulate delta and step simulation at a fixed rate (e.g. 1/60) while rendering at display rate.

Controls — delegate, do not improvise: load the \`controls\` playbook before writing any WASD / steer / flight code. It owns the sign convention, the strafe-is-not-steer split between shooters and vehicles, aircraft and pointer-lock handling, and the mandatory drive-it self-test. Racing is not the only genre that steers — planes, boats, jetskis, and mechs need the same file. The short version, so a run that skips it still knows what it is missing: with forward = (-sin(yaw), 0, -cos(yaw)), KeyA must produce steer = +1 and yaw += steer * turnRate * dt so A is player-visible LEFT; the most common shipped bug is KeyA → steer = -1, which inverts steering on every vehicle and aircraft. Track held-key state and consume it with dt, and support keyboard AND touch.

3D orientation (the "sideways/backwards" bugs): three.js is right-handed, +Y up; meshes face +Z, cameras look -Z. Cone/Cylinder primitives point +Y — rotate to align the tip with forward. To orient a mesh along \`forward\`, use mesh.lookAt(position + forward); for a camera, camera.lookAt(target). The camera must agree with movement — a chase cam sits behind the body along -forward.

Structure & finish: centralize game state; a simple state machine (menu → play → game over); score, restart, and basic juice (hit feedback, screen shake where it fits). Verify by PLAYING it — screenshot-only verification is insufficient for anything with movement.`,
    discovery: {
      reason:
        "The request is for a browser game, where game-loop, input, state, and playability patterns are directly applicable.",
      phrases: [
        "browser game",
        "web game",
        "html5 game",
        "canvas game",
        "game loop",
        "tarayici oyunu",
        "web oyunu",
      ],
      keywords: ["game", "oyun", "phaser"],
      aliases: ["browser game skill", "game patterns"],
    },
  },
  {
    id: "controls",
    name: "Player Controls & Steering",
    description:
      "WASD, vehicle steering, flight and pointer-lock input that isn't inverted.",
    category: "Build",
    scope: "app",
    // Grok's building-games playbook refuses to answer steering questions
    // itself: "Open .grok/skills/controls/SKILL.md before implementing any
    // WASD / steer / flight code… Do not treat genres/racing-kart.md as the
    // only place steer signs live — planes, jetskis, and mechs never open it."
    // (docs/product-transformation/grok-skills-dump-2026-08-17.md §2.) RIFT
    // carried the one-paragraph reminder inside browser-game but not the pack
    // it delegates to; this is that pack.
    instructions: `Anything the player drives, flies, or walks runs through this. Open it BEFORE writing input code — steering signs are the single most-shipped bug in browser games, and they are invisible in a screenshot.

The rule everything else serves: pressing A turns the vehicle LEFT ON SCREEN, D turns it RIGHT, while moving forward behind a chase camera. That is the only definition of correct. It is not "A decreases yaw" — whether that is left depends on the basis you chose, and choosing wrong is how the bug ships.

The sign convention, stated once so it cannot drift:
- Basis: \`forward = (-sin(yaw), 0, -cos(yaw))\`, world up = +Y, right-handed.
- With that basis: \`KeyA → steer = +1\`, \`KeyD → steer = -1\`, then \`yaw += steer * turnRate * speedFactor * dt\`.
- The bug: \`KeyA → steer = -1\` with \`yaw += steer * turnRate * dt\`. It compiles, it feels responsive, and it steers backwards on every vehicle, plane, and jetski.
- If you derive a different basis, DERIVE the sign with it — do not paste the line above onto a basis it does not belong to. Then confirm on screen, which is the only check that counts.

Strafe is not steer — the distinction that breaks ports between genres:
- FPS / walking character: A and D STRAFE. Movement is \`moveRight * strafe + moveForward * throttle\`; yaw comes from the mouse, never from A/D.
- Vehicle / boat / jetski: A and D STEER. There is no strafe; the body only goes where its nose points, and turn rate usually scales with speed (a parked car does not spin).
- Tank / mech: A and D rotate the hull in place; W/S drive along the hull's own forward.
- Fixed-wing: A and D are AILERONS — they roll, and the roll is what turns you (bank, then the lift vector pulls the nose round). Rolling left must produce a left turn; wire the rudder to yaw separately if you expose one. W/S is pitch, and pitch is a taste decision — pick inverted or not, then say which in the HUD.
- Helicopter / drone: A/D is lateral cyclic (translate sideways) with yaw on separate keys (Q/E). Do not fold them together.

Input plumbing, the parts that read as "laggy" when done wrong:
- Track HELD state in a key map on keydown/keyup and consume it every frame scaled by dt. Never drive movement from the keydown event itself — OS key-repeat makes it stutter, and diagonal input dies.
- Normalize diagonal movement so W+A is not faster than W.
- Reset the key map on window blur and on pointer-lock exit, or the player returns to a car that is still turning.
- \`event.code\` (KeyA), never \`event.key\` — \`key\` changes with layout, so AZERTY players get a broken game.
- \`preventDefault\` on the keys you own (arrows, space) so the page does not scroll under the canvas.

Pointer lock is for LOOK only:
- Request lock from a click-to-play overlay (browsers refuse it without a gesture); show the overlay again when lock is dropped, and pause rather than swallowing input.
- Mouse deltas drive yaw/pitch; clamp pitch to just under ±90° so the view never flips. WASD stays your own code — pointer lock gives you no movement.

The camera must AGREE with movement:
- Compute a dedicated \`moveForward\`/\`moveRight\` once per frame for movement, and never let camera code mutate them. Aliasing one shared temp vector between camera and movement makes them disagree — a real, reproducible bug that looks like "the controls feel drunk".
- Chase camera: \`desired = playerPos + up * height + moveForward * (-followDistance)\`, smoothed toward with exponential (delta-scaled) damping, then \`lookAt(player)\`. A camera that snaps reads as broken even when the steering is right.

Touch, because half the players are on a phone: a left virtual stick or steer buttons, a right throttle/fire zone, \`touch-action: none\` on the canvas, and no reliance on hover. Test that a two-finger touch does not zoom the page mid-game.

Debug in this order, and only this order — fixing out of order hides the real fault: (1) do the keys register at all, (2) are the movement signs right in world space, (3) does the camera agree. Log or overlay the raw key map first.

Mandatory self-test before you call it done. Expose a probe on the window — \`window.__controlsTest = () => ({ yaw, position, forward, keys })\` — then actually drive: hold W, confirm the body moves the way the camera faces; hold A while moving, confirm yaw changes so the body turns LEFT ON SCREEN and read the probe to confirm the sign; repeat for D; and for aircraft confirm roll-left produces a left turn. A screenshot cannot show any of this — a still frame of a car that steers backwards looks perfect. Drive it, or it is not verified.`,
    discovery: {
      reason:
        "The request involves driving, flying, or walking a player around, where steering signs and input plumbing decide whether it is playable at all.",
      phrases: [
        "pointer lock",
        "first person",
        "third person",
        "chase camera",
        "flight sim",
        "flight controls",
        "driving game",
        "racing game",
        "player movement",
        "wasd controls",
        "yaris oyunu",
        "araba oyunu",
        "ucus simulasyonu",
        "karakter kontrolu",
      ],
      keywords: [
        "wasd",
        "steer",
        "steering",
        "direksiyon",
        "surus",
        "vehicle",
        "arac",
        "araba",
        "car",
        "kart",
        "racing",
        "yaris",
        "flight",
        "ucus",
        "ucak",
        "plane",
        "drone",
        "helikopter",
        "helicopter",
        "joystick",
        "gamepad",
        "tank",
        "jetski",
        "boat",
        "tekne",
        "controls",
        "kontroller",
      ],
      aliases: ["controls skill", "steering skill", "input skill"],
    },
  },
  {
    id: "threejs-scene",
    name: "Three.js Scene Craft",
    description:
      "Correct renderer setup, lighting, cameras and motion for 3D scenes.",
    category: "Build",
    scope: "app",
    instructions: `For three.js / WebGL scenes (plain or React Three Fiber):
- Renderer: antialias on, \`renderer.outputColorSpace = SRGBColorSpace\`, \`toneMapping = ACESFilmicToneMapping\`, pixel ratio capped at 2 (\`setPixelRatio(Math.min(devicePixelRatio, 2))\`). Handle resize by updating camera aspect + renderer size; never stretch the canvas with CSS.
- Coordinate truths that prevent the classic bugs: right-handed, +Y up; meshes face +Z while cameras look -Z; Cone/Cylinder point +Y by default. Orient a mesh with \`mesh.lookAt(position + forward)\`, a camera with \`camera.lookAt(target)\`. Use \`THREE.Timer\` for frame delta, not \`Clock\`.
- Light like a photographer, not a spec sheet: one key light, a dim ambient or hemisphere fill so shadows stay readable, and a rim/back light when the subject must separate from a dark background. Pure white lights read as plastic — tint them slightly.
- Textures: color maps get \`SRGBColorSpace\`, data maps (normal/roughness) stay linear. Enable anisotropy for surfaces seen at grazing angles. Resize source images to what the scene needs; a 4K texture on a fist-sized object wastes the user's GPU and the sandbox's disk — remove oversized unused files after validating.
- Camera motion is eased, never teleported: damped OrbitControls (\`enableDamping\`, ~0.05), and focus transitions that lerp/slerp position and target together. Auto-rotate pauses while the user interacts and eases back afterwards.
- The scene breathes: something moves at idle (slow rotation, drift, twinkle) so the first frame doesn't read as a still image.
- Dispose geometries, materials and textures when objects leave the scene; stop the render loop when the tab is hidden.
- Composition is a design decision: place the subject off-center when UI panels share the viewport, and check it is not clipped by any edge at desktop AND mobile widths.
- Install three as a real dependency (\`npm install three\`, plus \`@types/three\` in TypeScript) and import from \`"three"\` / \`"three/addons/…"\`. NEVER scaffold the CDN-era pattern — no \`<script type="importmap">\`, no cdnjs script tags, and above all no \`r128\`-style pinned CDN builds. Those APIs are years out of date, they are what a model reaches for from memory, and the production build will not have three at all.
- In a React app prefer \`@react-three/fiber\` + \`drei\` over hand-rolled canvas bootstrapping; the pixel-ratio cap is \`dpr={[1, 2]}\` there. A self-contained plain-three module is fine too — it still installs from npm.
- Before calling a 3D scene done: three (and the R3F stack, if used) is in package.json, every import resolves, the production build passes, and no CDN script tag survives anywhere.`,
    discovery: {
      reason:
        "The request involves a 3D scene, where renderer configuration, lighting, and camera-motion craft decide the perceived quality.",
      phrases: [
        "three js",
        "3d scene",
        "3d globe",
        "3d model",
        "react three fiber",
        "orbit controls",
        "3d sahne",
        "donen kure",
        "3b sahne",
      ],
      keywords: [
        "3d",
        "3b",
        "threejs",
        "webgl",
        "globe",
        "kure",
        "gezegen",
        "dunya",
        "orbit",
        "shader",
        "r3f",
        "drei",
      ],
      aliases: ["threejs skill", "3d scene skill"],
    },
  },
  {
    id: "og-share-card",
    name: "Share Card & Meta",
    description: "A real 1200×630 share image and complete social meta tags.",
    category: "Build",
    scope: "app",
    instructions: `Every substantial app ships looking finished when a link to it is pasted into a chat. Do this unprompted — nobody asks for a share card, everybody notices a missing one:
- Any app with a face of its own gets a CUSTOM card built from its own art: games of every kind (a tic-tac-toe grid made of divs is still a game), playful and toy apps, creative tools, anything whose output is visual.
- Generate the card with \`generate_image\`: the product name in its display face over a scene that says what the app is. Then normalize it to exactly 1200×630 JPEG and keep it under 600KB (target ≤300KB — bump JPEG quality down a step and re-encode if over; oversized cards make scrapers flaky). Place it in public assets as \`og.jpg\`.
- LOOK at the generated card before using it. Garbled or misspelled text in generated imagery is common — if the lockup is dirty, generate a title-only variant and pick the clean one.
- Wire the full tag set in the document head — EXTEND the existing head, never replace it wholesale: \`og:title\`, \`og:description\`, \`og:image\` (+ \`og:image:width\` 1200, \`og:image:height\` 630), \`og:type\`, \`twitter:card\` (summary_large_image), \`twitter:title\`, \`twitter:description\`, \`twitter:image\`, plus \`<title>\` and \`<meta name="description">\` with the same copy.
- The description is written copy — one sentence that sells what the thing does, not "A web application".
- A favicon belongs in the same pass: a simple mark on the brand background, linked from the head — an SVG favicon scales everywhere and costs nothing. A blank tab icon reads as unfinished.
- If the app is worth installing (a game, a tool someone returns to), the same pass writes a web manifest and its PWA icons (192 and 512 square, plus a maskable variant). It is the difference between something that can live on a home screen and something that can only be a tab.
- The brand-asset pass needs only the name, theme, and palette — settle those early, and never let card generation block app work.`,
    discovery: {
      reason:
        "The request produces a shareable app, and a link pasted anywhere should unfurl with a real card rather than a blank.",
      phrases: [
        "og image",
        "share card",
        "social card",
        "open graph",
        "meta tags",
      ],
      keywords: ["og", "opengraph", "unfurl", "favicon"],
      aliases: ["og skill", "share card skill"],
    },
  },
  {
    id: "brand-identity",
    name: "Product Naming & Brand",
    description:
      "A real name, tagline, and hero asset — decided while building.",
    category: "Build",
    scope: "app",
    instructions: `A built thing gets an identity, decided during the build rather than in the summary:
- Name the product: one evocative word or a tight two-word mark, specific to what it does. "Apsis" for an orbital sandbox, "Meridian" for a globe of places — never "3D Globe App", never the request restated. Pair it with a five-word-or-fewer tagline.
- Use the name everywhere from the first moment it exists: page title, header lockup, loading copy, meta tags, and your own replies ("Meridian is live in the preview…").
- Give the wordmark typographic intent: a display face, deliberate letterspacing, a small kicker label above or below (e.g. OBSERVATORY over the name) when it suits the product's register.
- Generate ONE hero/brand asset with \`generate_image\` when the product has a visual identity worth staging. Prompt craft: front-load the subject, give strong high-level direction for mood, composition, lighting, and style in 2-5 sentences of natural prose — not keyword tags, not negative prompts.
- Image models are unreliable at exact text, numbers, and structure. When an asset needs specific text, data, or layout to be correct (charts, labeled diagrams, tables, screens with real copy), BUILD IT WITH CODE — HTML/CSS gives exact control. Use the image model only where the look is all that matters (scenes, characters, decorative art).
- Verify generated assets in a loop: look at the actual output, confirm every word and detail; garbled text means regenerate a simpler variant or rebuild with code — another edit pass usually garbles it again.
- Every string in the app belongs to this product: loading states ("Aligning meridians…", not "Loading…"), empty states, list content. Demo data is written as real editorial copy — a place card reads "Whitewashed towns cling to the cliff of a drowned volcano", never "Description goes here".`,
    discovery: {
      reason:
        "The request builds a product from scratch, and a real name, voice, and hero asset are what separate a finished thing from a demo.",
      phrases: [
        "brand identity",
        "product name",
        "logo and name",
        "marka kimligi",
      ],
      keywords: ["brand", "naming", "tagline", "wordmark", "marka"],
      aliases: ["brand skill", "naming skill"],
    },
  },
  {
    id: "photorealistic",
    name: "Photorealistic Prompting",
    description: "Write prompts that produce real-photo quality.",
    category: "Image",
    scope: "image",
    instructions: `For photorealistic images, write the prompt like a real photograph:
- Name a camera + lens (e.g. "shot on 85mm f/1.4"), and lighting (natural golden hour, soft studio, etc.).
- Specify depth of field, composition, angle, and realistic material/skin texture.
- Add quality anchors: "photorealistic, ultra-detailed, sharp focus, high resolution, professional photography".
- Avoid a plasticky, generic "AI art" look; describe imperfections and real-world detail.`,
  },
  {
    id: "logo-icon",
    name: "Logo & Icon Prompting",
    description: "Clean, scalable, memorable mark prompts.",
    category: "Image",
    scope: "image",
    instructions: `For logos and icons:
- Favor simple, geometric, scalable marks that read at small sizes. Describe a flat/vector feel, limited palette, strong silhouette.
- Use negative space and a single clear concept; avoid photorealism, gradients-heavy clutter, or tiny detail.
- State intended use (app icon, wordmark, monochrome variant) and background (transparent/solid).`,
  },
  {
    id: "brand-voice",
    name: "Brand Voice & Writing",
    description: "Clear, concise, professional tone across replies.",
    category: "General",
    scope: "all",
    instructions: `Write with a clear, professional voice:
- Be concise and direct; lead with the answer, then support it. Cut filler and hedging.
- Plain language over jargon; short sentences and scannable structure. No decorative emojis.
- Confident but honest: state uncertainty plainly, never overclaim.`,
    discovery: {
      reason:
        "The request explicitly includes brand voice, product copy, or marketing language that benefits from dedicated writing guidance.",
      phrases: [
        "brand voice",
        "tone of voice",
        "website copy",
        "marketing copy",
        "product copy",
        "marka dili",
        "metin yazarligi",
        "urun metni",
      ],
      keywords: ["copywriting", "microcopy", "tagline", "slogan"],
      aliases: ["brand voice skill", "writing skill"],
    },
  },
  {
    id: "sql-data",
    name: "SQL & Data Analysis",
    description: "Correct SQL and clear analysis of results.",
    category: "General",
    scope: "all",
    instructions: `For data tasks:
- Write correct, readable SQL; prefer explicit columns, sensible joins, and CTEs over nested subqueries. State assumptions about the schema.
- Guard against surprises: NULL handling, duplicates, timezones, and off-by-one on ranges.
- After a query, briefly interpret the result and flag anything anomalous. Show the query you ran.`,
    discovery: {
      reason:
        "The request explicitly requires SQL, relational data modeling, or data analysis, making query-specific guidance relevant.",
      phrases: [
        "database query",
        "database schema",
        "data analysis",
        "analytics query",
        "veri analizi",
        "veritabani sorgusu",
        "veritabani semasi",
      ],
      keywords: [
        "sql",
        "postgres",
        "postgresql",
        "mysql",
        "sqlite",
        "supabase",
        "cte",
      ],
      aliases: ["sql skill", "data analysis skill"],
    },
  },
  {
    id: "project-coordination",
    name: "Project Coordination",
    description:
      "Turn a project goal into bounded, owned work and verified decisions.",
    category: "Build",
    scope: "app",
    instructions: `Coordinate work around a concrete outcome:
- Read the current goal, constraints, relevant files and existing tasks before creating a plan. Continue recorded work rather than making a parallel duplicate.
- Define deliverables and observable acceptance criteria. Separate required work from optional improvements; keep the smallest useful plan.
- Assign each bounded task to one named owner with inputs, expected output and dependencies. Delegate only when an independent specialist adds value; do not call every available bot.
- Run independent investigations together, but serialize conflicting file changes and dependent steps. Respect the runtime's concurrency and approval limits.
- Track progress from actual task/run results. A submitted task is not completed; a proposed schedule is not saved until its mutation succeeds.
- Integrate participant evidence, resolve disagreements explicitly and request only the missing decision that blocks progress. Preserve the user's latest direction.
- End with decisions, completed deliverables, verification, remaining blockers and owner-assigned next steps. Never attribute work to a bot without a real recorded contribution.`,
  },
  {
    id: "evidence-research",
    name: "Evidence-led Research",
    description:
      "Investigate questions with attributable sources and explicit uncertainty.",
    category: "Build",
    scope: "app",
    instructions: `Produce research that another person can audit:
- Define the decision or question, the scope and what evidence would change the conclusion. Use the project context before searching broadly.
- Prefer first-party documentation, original datasets and direct observations. Check publication and event dates for time-sensitive claims; separate an announcement from a shipped capability.
- Read the underlying sources rather than relying on search snippets. Record useful source URLs, document titles or file paths close to the claims they support.
- Cross-check material disputed claims and actively look for counterevidence. Explain disagreements, unavailable sources and gaps instead of smoothing them over.
- Distinguish observed facts, source claims, inference and recommendations. Do not present guesses, inaccessible pages or a failed tool call as evidence.
- Compare options using the user's relevant criteria, including practical limits and prerequisites. Keep quotations brief and use original synthesis.
- Deliver a clear conclusion with supporting evidence, remaining uncertainty and a concrete next action. Do not modify files, publish material or contact third parties unless the task and available permissions authorize it.`,
  },
  {
    id: "quality-verification",
    name: "Quality Verification",
    description:
      "Reproduce defects and check acceptance criteria with concrete evidence.",
    category: "Build",
    scope: "app",
    instructions: `Verify behavior, not just the presence of an implementation:
- Translate the requested outcome into observable acceptance criteria and identify the highest-risk changed paths. Inspect existing tests and contracts first.
- Reproduce a reported defect with the smallest relevant case. Record inputs, environment, expected behavior and actual behavior before proposing a cause.
- For UI work, check keyboard interaction, focus, loading/error/empty states, viewport changes and retained state during navigation. For data/runtime work, check ownership, retries, cancellation and duplicate execution where relevant.
- Use focused tests and actual successful tool observations; avoid tests that merely repeat the implementation. Distinguish unit coverage from a real integration or user-flow check.
- A read-only reviewer reports a proposed command or fix instead of claiming to execute it. Request a permitted executor's evidence when access is missing.
- Report actionable findings with severity, affected path, reproduction and a specific correction. Separate confirmed defects from unresolved risks.
- After a fix, rerun the failing case and directly related regression checks. Report what passed, what was not tested and why; never claim flawless behavior or competitor parity from a narrow check.`,
  },
  {
    id: "video-planning",
    name: "Video Planning & Direction",
    description:
      "Create a coherent production plan, storyboard and reviewable edit.",
    category: "Build",
    scope: "app",
    instructions: `Develop video work from the audience and intended result:
- Establish the message, audience, platform, duration, aspect ratio and available footage. Inspect supplied assets and product facts before writing claims.
- Build one clear narrative arc. Write a timed shot list with visual action, camera/framing, transition, spoken or on-screen text and audio intent; every shot should serve the message.
- Maintain a consistent visual language across scenes: palette, lighting, typography, character/product identity and motion. Do not impose photorealism when the brief calls for another style.
- Distinguish existing assets, assets to generate and items requiring user input. Keep filenames, versions and dependencies explicit so a production task can be handed off.
- Use actual permitted media-generation/editing tools when producing assets. If no such tool is available, deliver the storyboard and production instructions without pretending a video was rendered.
- Review the assembled result for timing, readable captions, audio levels, continuity, safe-area placement and the requested export format. Respect reduced-motion needs for embedded UI material.
- Provide a usable artifact or preview when one exists, with brief review notes and any missing shots. Publishing and third-party messages remain separate authorized actions.`,
  },
  {
    id: "project-operations",
    name: "Project Operations",
    description:
      "Maintain reliable routines, task ownership and useful project status.",
    category: "Build",
    scope: "app",
    instructions: `Keep project operations dependable and easy to follow:
- Inspect the current tasks, owners, dependencies and recent run results before creating or changing work. Deduplicate by purpose and existing task identity.
- Give each task an actionable title, one accountable owner, required inputs, expected output and completion criteria. Keep a project status separate from a specific run's state.
- For routines, record the intended timezone, schedule, prerequisites and expected result. Use the provided durable scheduler; do not invent a schedule or rely on a browser timer.
- Respect enabled/paused/archived states. Before retrying a failed or interrupted action, inspect current state and previous evidence to avoid repeating side effects.
- Surface actionable blockers with their owner and next decision. Do not mark work active from an old timer or complete merely because a request was accepted.
- Keep status updates short and grounded in changes since the previous update. Distinguish overdue, awaiting input, failed and completed work.
- Finish with the records actually created or changed, outstanding commitments and next review point. Do not send reminders or external updates without the relevant authorization.`,
  },
  {
    id: "focused-implementation",
    name: "Focused Implementation",
    description:
      "Make scoped changes in the existing stack and verify the result.",
    category: "Build",
    scope: "app",
    instructions: `Implement the requested behavior with a small, reviewable change:
- Inspect the repository instructions, relevant code, current state and existing dependencies before selecting an approach. Follow the actual stack rather than assuming a framework.
- Clarify acceptance criteria from the request and trace the affected data/control flow. Reproduce defects before changing unrelated code.
- Preserve existing user changes, ownership checks and public contracts. Prefer an existing component, service or helper when it already expresses the needed behavior.
- Handle meaningful loading, failure, cancellation and retry cases. Keep persisted state authoritative and avoid duplicate side effects.
- Make dependent changes together, but avoid broad cleanup or adding infrastructure the task does not need. Keep credentials and sensitive values out of output.
- Run the smallest useful verification first, then required type, build or integration checks. Use a real UI or runtime observation when a static test cannot establish the outcome.
- Report the changed behavior, verification evidence and material limitations. Do not claim deployment, successful execution or a generated artifact without the corresponding successful result.`,
  },
  {
    id: "concise-expert",
    name: "Concise Expert Mode",
    description: "Terse, high-signal answers that assume expertise.",
    category: "General",
    scope: "all",
    instructions: `Respond like a senior expert briefing a peer:
- High signal, low noise. Skip preamble and restating the question. Give the answer, then only the reasoning that matters.
- Assume the user is technical; don't over-explain basics unless asked. Use precise terminology.
- When there's a clear best option, recommend it directly instead of listing every alternative.`,
    discovery: {
      reason:
        "The user explicitly requested a terse, expert-level response style, so this communication mode is relevant.",
      phrases: [
        "expert mode",
        "high signal",
        "short answer",
        "kisa cevap",
        "uzman modu",
      ],
      keywords: ["concise", "terse", "uzatmadan"],
      aliases: ["concise mode", "expert response mode"],
    },
  },
] as const satisfies readonly SkillCatalogDefinition[];

export type SkillCatalogId = (typeof SKILL_CATALOG)[number]["id"];
