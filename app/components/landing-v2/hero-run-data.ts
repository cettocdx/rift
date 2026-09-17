/**
 * One real run, transcribed.
 *
 * Every string below was read off a 3840-wide capture of the product executing
 * `build a gravity simulation…` on 14 Aug 2026 — the plan items, the shell
 * commands, the counters, the sandbox URL, the telemetry the finished app
 * reported. Nothing here is written for the landing page, which is the whole
 * point: the hero replays a run that happened rather than one that reads well.
 *
 * Keep it that way. If the demo needs different content, record another run and
 * transcribe that; do not edit these strings to be more impressive.
 */

export const HERO_RUN = {
  /** The transcription date from this file's header, as a field so a
   *  receipt rendered from this data can show it without hardcoding it. */
  capturedOn: "14 Aug 2026",
  task: "build a gravity simulation: bouncing balls with collisions, in one HTML file",
  thoughtSeconds: 0.8,
  reasoning:
    "I'll build a self-contained canvas simulation with fixed-timestep physics, adjustable gravity, ball spawning, pause/reset controls, collision handling, and responsive mouse/touch interaction.",
  checklist: [
    "Balls fall, bounce, and collide with each other and the walls.",
    "Click/tap adds balls; controls adjust gravity, ball count, pause, and reset.",
    "Stable fixed-timestep loop with resize-safe canvas scaling.",
    "One standalone HTML file that runs without dependencies.",
  ],
  plan: [
    "Define simulation visual system",
    "Implement single-file physics",
    "Exercise controls and collisions",
    "Verify responsive production app",
    "Present live simulation",
  ],
  // `code: true` marks a literal shell token, which takes the mono face. File
  // names and prose arguments do not — the same line the product draws.
  operations: [
    {
      kind: "Executed",
      detail: "mkdir -p /home/oai/share/gravity-lab",
      code: true,
    },
    { kind: "Creating", detail: "index.html", code: false },
    { kind: "Wrote", detail: "index.html", code: false },
    {
      kind: "Started background",
      detail: "python3 -m http.server 4173 --bind 0.0.0.0",
      code: true,
    },
  ],
  /** Final values from the run's own header, not estimates. */
  totals: {
    agents: "1/1",
    tools: 2,
    added: 491,
    removed: 0,
    cost: 12.5,
    budget: 75,
    context: 322,
  },
  sandboxUrl: "https://4173-immeh952f20vc6lui9uta.e2b.app",
  artifact: {
    name: "Gravity Lab",
    tagline: "Real-time rigid body playground",
    telemetry: [
      { label: "BODIES", value: "18" },
      { label: "FPS", value: "120" },
      { label: "ENERGY", value: "236.0m" },
    ],
    shot: "/landing/product/gravity-lab.jpg",
  },
  durationLabel: "3.1m",
} as const;
