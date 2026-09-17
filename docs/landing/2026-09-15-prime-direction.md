# RIFT — From thought to impact

User delegated direction, tools, implementation and iterative review. Target: localhost:3020/landing, preserving authenticated app routes. PrimeSec-inspired charcoal/acid yellow, sculptural object, huge typography, quiet supporting composition. Actual product: Build, Studio, Hack Workbench; desktop UI confirms all three.

Chosen direction: a physical RIFT emblem extruded in brushed metal, with a luminous yellow seam, lightly responding to the pointer. It represents the passage from intent into execution. Alternative literal classical sculpture is too close to PrimeSec. Generic floating dashboard is too anonymous. Use the approved vector for brand fidelity.

Palette: graphite #191919, paper #f2f1e9, acid #f3ff5c, secondary #a8a8a1, line #343530. Display Space Grotesk; body system/Geist; utility monospace. Broad desktop grid, left aligned headline, right sculptural emblem, bottom product navigation. Follow with actual desktop capture switcher, editorial workflow descriptions, model choice, FAQ and download CTA. No fabricated customers, usage metrics or testimonials.

Motion: custom ease-out, restrained 160–220ms press feedback, 650–900ms one-time entrance, pointer tilt with damping; no scroll hijacking. Reduced motion static; explicit ambient pause. WebGL is decorative and gracefully falls back to approved SVG. Pause when offscreen/hidden. Cap DPR.

Implementation: new PrimeLanding.tsx, PrimeSculpture.tsx, prime.module.css. Wire public /landing and signed-out root only after review. Capture desktop screens through CUA. Keep existing ActionLanding source for rollback. Verify type/lint, desktop/mobile, keyboard, real CTA destinations, media loading, WebGL cleanup. Build isolated release before restarting local preview.

Self-review: avoid invented status badges, fake terminal feeds, decorative data grids and generic cards. Main message must communicate concrete work; the object must look deliberately art-directed, not a torus demo. Evaluate against Awwwards Design 40 / Usability 30 / Creativity 20 / Content 10 without asserting a jury outcome.
