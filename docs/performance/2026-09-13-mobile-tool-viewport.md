# Mobile Preview and Computer visible viewport

The full-screen mobile tool portal previously used `top: 0; height: 100dvh`.
When the software keyboard only reduces the visual viewport, that box still
occupies the layout viewport. With an 844px layout and a reported 400px viewport
offset by 40px, the close header and lower panel content were outside the visible
area. The existing Chat settings/navigation viewport handling did not apply to
this separate portal.

## Change

`MobileToolDialog` now attaches the existing `observeChatViewport` observer when
Radix mounts the portal. Its inline top and height use the reported offset and
height, with the original full-screen geometry as fallback. Ref cleanup removes
listeners and clears only the detached focus target. The observer writes CSS
properties without rerendering the transcript; it restores normal geometry for
pinch zoom, desktop/fine pointers, invalid measurements and keyboard dismissal.
No guessed keyboard height, forced document scrolling or automatic focus change
was added. Radix focus trapping and the existing chat inert boundary remain.

## Regression and test fidelity

Two Chromium cases failed on the unchanged component at the dialog bounds
assertion: first opening with a reduced viewport, and reduction after opening.
Log: `/tmp/rift-mobile-tools-viewport-red2.log`.

The first diagnostic attempt hit stale fixture setup instead: the preview had no
chat identity for the current health hook. The fixture now supplies an owned
synthetic chat ID and a local health-service response whose chat/URL pair must
match. It keeps the real health hook, preview panel and iframe navigation. The
older interaction test also referenced the obsolete iframe title; its selector
now follows the current `App preview` accessible title. These were fixture
repairs, not changes to production authorization or preview-health behavior.

Preview → Computer now uses a keyed fixture dialog to reproduce the production
unmount/remount boundary. This exercises observer reattachment and background
restoration instead of only replacing children inside an existing portal.

The new browser cases cover 360/390/430px in Chromium and WebKit, reported
400/280/340px heights and offsets, address focus/draft retention, full close
target/content bounds, panel switching, pinch fallback and keyboard dismissal.
Existing checks cover continuous output, reading anchors, touch close, draft
and focus restoration, preview interaction/navigation, layout-width changes and
activity history selection. All **42 cases passed**, including the keyed panel
transition, in `/tmp/rift-mobile-tools-viewport-full.log` (2.7 minutes). The first
12 new viewport cases also passed before the fixture lifecycle correction; the
full result supersedes that narrower check. The existing MobileToolDialog and
ChatViewport unit suites passed **18 tests** in
`/tmp/rift-mobile-tool-viewport-unit.log`, including focus trapping and cleanup.

Visual inspection of the 390px Chromium screenshot confirmed the Preview header,
address and controls inside the reported 60–340px area. The dark area outside it
represents the simulated unavailable viewport, not an OS keyboard image.

These are browser simulations of the visual viewport contract. They do not open
an OS keyboard or prove physical iPhone/Android behavior. Authentication,
provider/worker calls and preview health are isolated service fixtures; no user
task or external scan is started.
