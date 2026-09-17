# Hack Workbench draft reflow

The composer previously recalculated height only when draft text changed. Resizing the window, rotating a mobile viewport, or changing sidebar width left the same draft at its old height. A later desktop CSS rule also overrode the earlier mobile 16px input size.

The textarea now observes width changes and schedules one autosize update on the next animation frame, with pending work cancelled on unmount. Height-only observer deliveries do not schedule work. The final mobile rule preserves 16px text up to 800px.

A regression test failed before the change: after simulated narrowing the expected 96px height remained 24px. All 15 lifecycle tests now pass, including draft preservation, grow/shrink, the 144px cap and no accidental submission.

`node scripts/verify-hack-composer.cjs` bundles the actual sizing effects and all production workbench CSS in a bounded WebKit fixture. It keeps one draft while changing viewport width 1000→320→390→800→1000. Observed heights were 45→144→144→75→45px, mobile font size 16px, and no horizontal overflow or page errors. Long drafts above the cap remain internally scrollable. A first synchronous observer implementation raised a ResizeObserver loop warning; deferred updates eliminated it in this replay.

This fixture verifies CSS and input reflow, not physical iPhone keyboard behavior, live agent execution, or all mobile application pages.
