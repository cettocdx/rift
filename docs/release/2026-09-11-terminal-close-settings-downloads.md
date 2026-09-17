# Final terminal close, Settings touch actions and downloaded runner parity

Source: `/Users/cetto/RIFT-Release`, following `d6d4a55`.

## Final terminal close

Installed testing exposed a lifecycle/UI mismatch: closing the last idle shell
killed PID 88236 but immediately created replacement PID 88369 (Terminal 2).
The layout reducer deliberately created that replacement. It now retains a
canonical empty layout, including across remount/reload, until the user starts a
terminal. Malformed saved layouts are still rejected. Adding or splitting from
empty creates one valid selected terminal. Close is disabled when empty.

The empty panel offers Start terminal. Explicit final-close and terminal-focus
intent transfer keyboard focus there after the visible panel commits; passive
restoration does not steal focus. The new control reserves 44px height for touch.
Two regression tests failed on the old behavior; **21 focused tests pass** after
the fix. Reviewer feedback also covered compact console-to-terminal focus timing.
Logs: `/tmp/rift-close-last-red.log`, `/tmp/rift-close-last-green.log`.

## Settings touch actions

Settings alone now gives coarse-pointer buttons, text inputs and selectors real
44px targets. WebKit native selects need explicit height in addition to minimum
height. The account dialog opts in separately because it renders in a portal;
its title reserves space for the larger close target. Fine-pointer density and
other workspaces' shared Button styles remain unchanged.

Actual ApiKeysTab testing revealed that WebKit does not focus pointer-activated
buttons reliably. Its previous blur-only Revoke cancellation left an armed
confirmation after tapping elsewhere. A scoped outside-pointer listener now
cancels while armed, retaining keyboard blur behavior. Fixture assertions prove
outside taps cause zero revocations and two deliberate taps invoke exactly one
synthetic callback. No real API key was changed.

**28 current-source browser cases passed, zero skipped/flaky**, across
Chromium/WebKit, 360/390/430, coarse/fine, desktop, and 844/500 heights. Twelve
measured coarse targets reached 44px; fine dimensions were preserved. Real
SettingsShell, API keys, Account, Extra Usage and Appearance components use
synthetic services. Existing affected tests: five passed. This does not replace
the still-open full authenticated mobile suite or physical-device testing.
Report: `e2e/mobile-fixture/results/settings/report.json`, execution start
`2026-09-11T00:35:07.353Z`; preserved report
`/tmp/rift-settings-complete-2026-09-11T00-35-07.353Z.json`.

## User-facing download integrity

The Local runner download was stale despite reporting version 0.8.4. It omitted
managed-session, command-worker and output-delivery modules from the current
source. The packaging helper compiles source in isolated staging, checks emitted
runtime modules in the archive, and records source/archive hashes. Web builds
regenerate it without replacing a running receiver's dist. The connect command
includes the archive hash as a cache key. This is cache busting, not an installer
signature or client-side integrity check. See `scripts/local-cli-distribution.md`
for exact packaging, smoke and desktop-download gates.

The independent interactive `rift` console is a different artifact. Its 56
console tests and ten OpenTUI tests passed, as did 16 release-source/desktop-script
checks. Rebuilding the standalone darwin-arm64 console from current source yielded
SHA-256 `7a2675932f62847b7dd4c949582d5db2ef6166f72801b03206c2dd853d88b64e`,
exactly matching the installed `/Users/cetto/.local/bin/rift` and release manifest.
`rift --version` reports 0.3.5. No installed console replacement was necessary.

The public DMG remains a separate release gate: its inspected binary lacks the
new durable terminal protocol, and its current provenance manifest is absent.
It must be rebuilt from canonical desktop configuration with the intended
production URL, then verified, signed/notarized and installation-tested. The
Applications UI Preview installation is not proof that this public DMG is ready.

## Live continuity and combined release verification

Native Python process 93474 ran under shell 88369 for ten minutes, producing
120 markers at five-second intervals. During execution the user interface moved
to Settings, reloaded, minimized, returned to Build, reopened Terminal, reloaded
again, and received a production web-service restart. The same shell and worker
PIDs were verified while active. The worker's evidence file contains exactly
120 unique markers in expected order. Visible terminal snapshots sampled the
stream and finally showed marker 120, RIFT_SOAK_COMPLETE and the shell prompt.
This proves emitter continuity and observed UI recovery; it is not a byte-for-byte
capture of the entire renderer history. Settings navigation hid the dock, so it
was explicitly reopened to inspect continued output.

The evidence emitter is `/tmp/rift-native-soak-20260911.py`, with output in
`/tmp/rift-native-soak-20260911-0040.log`. An earlier complex command was mangled
by the UI automation's keyboard translation and rejected by Python before the
soak began; the successful run used this explicit script path, once.

After the combined production build, closing the final terminal displayed
No terminal is running, disabled Close, and focused Start terminal. OS inspection
showed no remaining child shell. Cmd+R preserved that empty state; Start terminal
was then deliberately selected. Build log:
`/tmp/rift-settings-close-download-web-build.log`; 3020 login returned HTTP 200.
The actual HTTP-downloaded Local runner hash matches the source archive:
`cc3befb29c4c834d6c7085731d043d5c438f6b0c6981a954c619ebc83968d51f`.
Packaging validation passed five Node tests and eight connection-command tests,
plus isolated install/runtime smoke and current-source archive verification.
The public DMG gate failed as expected because provenance is missing; canonical
rebuild/verification is the next work item, not a passed gate.

No model call, assessment or real account/billing mutation is part of this batch.
Production worker promotion, model first-response latency, all-device acceptance,
competitor parity and landing redesign remain open. Final commit hooks are
recorded separately after they complete.
