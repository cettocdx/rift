# Native reasoning selection and visibility

## Confirmed causes

- The native composer used the first supported effort when the current setting was unsupported. For toggle models, a carried-over `medium` became `off` because the server advertises `[off, on]`.
- Reasoning-only activity had no disclosure arrow. Its content was hidden behind an Activity sheet and another initially collapsed disclosure.

## Changes

- One resolved effort property drives the request, composer label and menu selection. It preserves valid explicit choices, including Off; unsupported qualitative settings fall back to Medium or On when supported.
- Provider-supplied reasoning has a compact three-line transcript preview and a disclosure affordance even without tool calls.
- The Activity panel opens with thinking content expanded; the user can still collapse it. Full text remains available alongside actual tool receipts. No fabricated reasoning or tool events are added.

## Verification

- Real URLSession request captured through a test URLProtocol: before fix, expected On but received Off. Explicit Off already passed. `/tmp/rift-mobile-reasoning-red.log`.
- After fix: 62 native unit tests passed. `/tmp/rift-mobile-reasoning-green.log`.
- Four navigation UI tests passed: Activity/Preview, repeated workspace navigation, Studio draft preparation, and keyboard dismissal. `/tmp/rift-mobile-reasoning-ui.log`.
- Hosted native views rendered in light/dark with a synthetic provider event for visual inspection. This is UI fixture evidence, not a live provider transcript. The corrected fixture inherits the same monochrome tint as RIFTApp. `/tmp/rift-mobile-reasoning-colors.log`.
- Thinking visibility still depends on a provider returning reasoning events. These changes do not establish production provider availability or universal model reasoning support.

## Distribution

Build 6 archive and upload verified. Production-source delta from shipped build 5 is limited to AgentActivity.swift, RIFTStore.swift and WorkspaceView.swift.

Archive completed: `/tmp/RIFT-TestFlight-0917-build6.xcarchive`. CFBundleVersion 6, production origin and strict code signature passed. Source hashes match `/tmp/rift-ios-build6-source-manifest.json`. Upload succeeded at 12:08:00 via `/tmp/rift-testflight-0917-build6-upload.log` (exit 0). Apple Build Uploads confirms 0.1.0 (6), Processing, created 12:07 PM. Internal group availability is pending.

Final inspected fixture screenshots: `/tmp/rift-mobile-reasoning-final-screens/ED8836D4-9AC9-4974-A951-3EE265DDD78C.png` (dark transcript), `/tmp/rift-mobile-reasoning-final-screens/3576B28C-A03F-43E7-B4E0-B12E7F601E4C.png` (expanded thinking). Light-theme fixture was also rendered; original preview inspected before applying the production tint to the test host.
