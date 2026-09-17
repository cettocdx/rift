/**
 * What each surface of the mini app contains.
 *
 * Kept out of the component so the interface code stays about behaviour, and so
 * the claims stay auditable in one place. Every number and every tool name here
 * is one the product ships: the agent roster, the workbench's tool list, the
 * model vendors and the plan structure all match what the application does.
 * The runs themselves are prepared rather than live, which the frame says.
 */

import { MEDIA_MODELS } from "@/types/chat";

export type OpIcon = "search" | "term" | "diff" | "image" | "shield" | "check";

export type Op = { verb: string; arg: string; icon: OpIcon };

export type SurfaceId =
  | "build"
  | "studio"
  | "workbench"
  | "agents"
  | "tasks"
  | "plugins";

/** A prepared run: what the agent says, plans, and does. */
export type Run = {
  id: string;
  prompt: string;
  /** Matched against the visitor's text, lowercased. */
  match: readonly string[];
  reply: string;
  plan: readonly string[];
  ops: readonly Op[];
  diff: { added: number; removed: number };
  tools: number;
  seconds: number;
};

/* ── Build ────────────────────────────────────────────────────────────── */

export const BUILD_RUNS: readonly Run[] = [
  {
    id: "test",
    prompt: "the pricing test is failing, find out why and fix it",
    match: ["test", "fail", "bug", "fix", "error", "hata"],
    reply:
      "Reading the failing spec and the module it covers, then correcting the margin path.",
    plan: [
      "Reproduce the failure",
      "Read the spec and the module",
      "Correct the retail margin path",
      "Re-run the suite",
    ],
    ops: [
      { verb: "Searched", arg: "pricing.test.ts", icon: "search" },
      { verb: "Ran", arg: "pnpm test pricing", icon: "term" },
      { verb: "Read", arg: "lib/pricing/model-price.ts", icon: "search" },
      { verb: "Edited", arg: "lib/pricing/model-price.ts", icon: "diff" },
      { verb: "Ran", arg: "pnpm test pricing", icon: "check" },
    ],
    diff: { added: 53, removed: 9 },
    tools: 7,
    seconds: 111,
  },
  {
    id: "game",
    prompt: "build a gravity simulation with bouncing balls in one HTML file",
    match: ["build", "game", "simulation", "canvas", "html", "oyun", "yap"],
    reply:
      "One standalone file: fixed-timestep physics, collisions, and controls for gravity and ball count.",
    plan: [
      "Define the simulation surface",
      "Implement single-file physics",
      "Add collisions and controls",
      "Verify it runs with no dependencies",
    ],
    ops: [
      { verb: "Created", arg: "index.html", icon: "diff" },
      { verb: "Ran", arg: "python -m http.server", icon: "term" },
      { verb: "Opened", arg: "localhost:8000", icon: "search" },
      { verb: "Edited", arg: "index.html", icon: "diff" },
      { verb: "Verified", arg: "60fps, no console errors", icon: "check" },
    ],
    diff: { added: 295, removed: 0 },
    tools: 6,
    seconds: 96,
  },
  {
    id: "api",
    prompt: "add rate limiting to the public API and prove it works",
    match: ["api", "rate", "limit", "endpoint", "server"],
    reply:
      "A sliding-window limiter on the edge, with a test that actually exhausts the budget.",
    plan: [
      "Read the current route handlers",
      "Add a sliding-window limiter",
      "Write a test that exhausts the budget",
      "Run the suite",
    ],
    ops: [
      { verb: "Read", arg: "app/api/**/route.ts", icon: "search" },
      { verb: "Created", arg: "lib/rate-limit.ts", icon: "diff" },
      { verb: "Edited", arg: "app/api/publish/route.ts", icon: "diff" },
      { verb: "Ran", arg: "pnpm test rate-limit", icon: "check" },
    ],
    diff: { added: 141, removed: 12 },
    tools: 5,
    seconds: 128,
  },
];

/* ── Studio ───────────────────────────────────────────────────────────── */

/** A frame Studio produced. `src` points at the real output, not a mockup. */
export type Shot = {
  label: string;
  kind: "Image" | "Video";
  note: string;
  src: string;
};

/**
 * The model chips, read from the renderers Studio actually offers.
 *
 * This was a hand-typed list and every entry in it had gone stale: "Seedream
 * 4" is 5.0 Pro, "Nano Banana Pro" is Nano Banana 2, "Flux 2" is FLUX.2 Max —
 * and "Sora 2" is a model this product has never shipped, sitting on a landing
 * page under a competitor's name. The same defect was found and fixed on the
 * model wall; it survived here because the two lists were typed twice.
 *
 * Six chips, because that is what the strip is laid out for. Taking the first
 * six of MEDIA_MODELS keeps the order the product itself presents them in.
 */
export const STUDIO_MODELS = MEDIA_MODELS.slice(0, 6).map(
  (model) => model.name,
);

/**
 * Three real Studio outputs.
 *
 * A fourth tile used the video's poster frame, which measures an average luma
 * of 2 out of 255 — it is the black frame before the film starts, and at
 * thumbnail size on a near-black page it is indistinguishable from an empty
 * box. A frame that shows nothing is worse than one tile fewer.
 */
export const STUDIO_SHOTS: readonly Shot[] = [
  {
    label: "Material study",
    kind: "Image",
    note: "Precise reflections and product geometry",
    src: "/landing-v2/studio-product.webp",
  },
  {
    label: "Interface render",
    kind: "Image",
    note: "One identity across every frame",
    src: "/landing-v2/studio-chrome.webp",
  },
  {
    label: "Architecture",
    kind: "Image",
    note: "Natural light, scale and spatial clarity",
    src: "/landing-v2/studio-landscape.webp",
  },
];

/* ── Hack Workbench ───────────────────────────────────────────────────── */

export type Finding = { severity: "high" | "medium" | "info"; text: string };

export const WORKBENCH_TARGET = "scanme.nmap.org";

export const WORKBENCH_LINES: readonly string[] = [
  "scope declared · scanme.nmap.org · authorised",
  "nmap -sV -T4 scanme.nmap.org",
  "22/tcp   open  ssh      OpenSSH 6.6.1p1",
  "80/tcp   open  http     Apache httpd 2.4.7",
  "9929/tcp open  nping-echo",
  "whatweb http://scanme.nmap.org",
  "verifying 5 candidate findings",
  "discarded 3 · unreproducible",
];

export const WORKBENCH_FINDINGS: readonly Finding[] = [
  { severity: "medium", text: "Apache 2.4.7 — end-of-life build, known CVEs" },
  { severity: "info", text: "OpenSSH banner discloses exact version" },
];

/* ── Agents ───────────────────────────────────────────────────────────── */

export type Agent = { name: string; role: string; brief: string };

/**
 * Eight of the twenty-nine archetypes the catalog ships, chosen to show the
 * spread rather than the whole list — a roster of twenty-nine in a 260px panel
 * is a scrollbar, not an argument.
 */
export const AGENTS: readonly Agent[] = [
  {
    name: "Buddy",
    role: "Generalist Engineer",
    brief: "Takes the whole task when it does not need a specialist.",
  },
  {
    name: "Sentinel",
    role: "Security Engineer",
    brief:
      "Declares scope before it touches anything, and verifies before it reports.",
  },
  {
    name: "Hex",
    role: "Debugging Specialist",
    brief:
      "Reproduces first. Will not propose a fix for a failure it has not seen.",
  },
  {
    name: "Miso",
    role: "Product Designer",
    brief:
      "Owns the type scale, the spacing rhythm and the interaction states.",
  },
  {
    name: "Probe",
    role: "Quality Engineer",
    brief:
      "Writes the test that fails for the right reason before the fix lands.",
  },
  {
    name: "Scout",
    role: "Research Analyst",
    brief:
      "Reads the sources and reports what they say, not what would be convenient.",
  },
  {
    name: "Dash",
    role: "Workflow Orchestrator",
    brief:
      "Splits the work, runs the parts in parallel, and reassembles the result.",
  },
  {
    name: "Sunny",
    role: "Developer Advocate",
    brief: "Writes the docs and the examples against the shipped behaviour.",
  },
];

/* ── Tasks ────────────────────────────────────────────────────────────── */

export type Task = { id: string; title: string; meta: string; done: boolean };

export const TASKS: readonly Task[] = [
  {
    id: "t1",
    title: "Fix the pricing margin path",
    meta: "Build · 2m ago",
    done: true,
  },
  {
    id: "t2",
    title: "Rate limit the public API",
    meta: "Build · 14m ago",
    done: true,
  },
  {
    id: "t3",
    title: "Render the product film",
    meta: "Studio · running",
    done: false,
  },
  {
    id: "t4",
    title: "Audit scanme.nmap.org",
    meta: "Workbench · queued",
    done: false,
  },
  {
    id: "t5",
    title: "Write the release notes",
    meta: "Agents · queued",
    done: false,
  },
];

/* ── Plugins & MCP ────────────────────────────────────────────────────── */

export type Plugin = {
  name: string;
  kind: string;
  note: string;
  on: boolean;
  /** Key into the logo map in RiftMiniApp; absent means a built-in tool. */
  logo?: "github" | "figma" | "notion" | "vercel";
};

/**
 * Three tools the sandbox always has, and four the run reaches over MCP.
 *
 * The MCP entries carry their vendors' own marks rather than a generic plug
 * icon: a reader scanning this row is looking for a name they recognise, and a
 * row of identical grey squares defeats the only job it has.
 */
export const PLUGINS: readonly Plugin[] = [
  {
    name: "Filesystem",
    kind: "built in",
    note: "Read, write and search the sandbox",
    on: true,
  },
  {
    name: "Terminal",
    kind: "built in",
    note: "Run anything the container can run",
    on: true,
  },
  {
    name: "Browser",
    kind: "built in",
    note: "Open a page and read what rendered",
    on: true,
  },
  {
    name: "GitHub",
    kind: "MCP",
    note: "Open a PR from the thread that wrote it",
    on: true,
    logo: "github",
  },
  {
    // Vercel, not Figma: the Plugins row claims MCP connectors, and Figma is
    // not in MCP_CATALOG while Vercel is (mcpCatalog.tsx). A connector shown
    // here that the Connect section cannot show is a claim the product does
    // not back.
    name: "Vercel",
    kind: "MCP",
    note: "Ship the branch the run just built",
    on: false,
    logo: "vercel",
  },
  {
    name: "Notion",
    kind: "MCP",
    note: "Pull the spec the task refers to",
    on: false,
    logo: "notion",
  },
  {
    name: "Vercel",
    kind: "MCP",
    note: "Ship the build and read the deploy log",
    on: false,
    logo: "vercel",
  },
];

/* ── Routing ──────────────────────────────────────────────────────────── */

/**
 * Which surface a typed prompt belongs to.
 *
 * The hero's input invites the visitor to "build, fix or investigate", so all
 * three verbs have to land somewhere. Two failures this replaces:
 *
 *  - The first matcher took the first run whose term appeared anywhere in the
 *    string, so "audit my server for exposed services" matched `server` and ran
 *    the rate-limiting scenario. A single shared word outvoted the actual verb.
 *  - Every prompt landed on Build, but the audit scenario lives in the
 *    Workbench and generation lives in Studio. Asking to investigate something
 *    and being shown a code diff is a wrong answer, not a near miss.
 *
 * So: the surface is decided first, from the verb, and only then is a Build run
 * chosen — by counting matched terms rather than taking the first hit, so the
 * prompt with the most in common wins.
 */
const WORKBENCH_TERMS = [
  "audit",
  "security",
  "secure",
  "scan",
  "recon",
  "port",
  "vulnerab",
  "cve",
  "pentest",
  "exploit",
  "exposed",
  "investigate",
  "guvenlik",
  "güvenlik",
  "tara",
];

const STUDIO_TERMS = [
  "image",
  "video",
  "render",
  "film",
  "photo",
  "shot",
  "poster",
  "thumbnail",
  "generate a",
  "gorsel",
  "görsel",
  "resim",
  "video",
];

export type Route = { surface: SurfaceId; run?: Run };

export function routePrompt(text: string): Route {
  const t = text.toLowerCase();

  if (WORKBENCH_TERMS.some((term) => t.includes(term))) {
    return { surface: "workbench" };
  }
  if (STUDIO_TERMS.some((term) => t.includes(term))) {
    return { surface: "studio" };
  }

  // Score rather than first-match: a prompt sharing three terms with one run
  // and one with another belongs to the first.
  let best = BUILD_RUNS[0];
  let bestScore = 0;
  for (const run of BUILD_RUNS) {
    const score = run.match.filter((term) => t.includes(term)).length;
    if (score > bestScore) {
      best = run;
      bestScore = score;
    }
  }
  return { surface: "build", run: best };
}
