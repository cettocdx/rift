# Desktop web and computer access — 2026-09-08

## Reproduced issue

The active RIFT UI Preview (app.riftsys.ui-preview, frontend 3020) could not read localhost from a Cloud task. The desktop relay previously started only when a native file/folder grant existed, while localhost additionally required a directory grant. A selected file was insufficient. File access also did not implement mouse/keyboard/screen control.

Public web reading was already implemented separately. The real renderPublicBrowserPage implementation successfully loaded https://example.com through isolated Chromium: HTTP 200, title Example Domain, 559 bytes, one allowed request, zero blocked requests. No personal browser profile was used.

## Changes

- Independent session grants for Local websites and Computer control, exposed under Settings → Workbench & terminal → This Mac.
- Relay remains usable from Cloud tasks when RIFT Desktop is online; it no longer requires file sharing. User account ownership and target connection checks remain enforced.
- Native localhost requests remain bounded GET/HEAD requests with loopback-only redirect validation. Revocation is checked before requests and before returning a result.
- macOS main-display capture, normalized click coordinates, bounded typing, allowlisted key combinations, and bounded scrolling. These require the native session grant plus Screen Recording / Accessibility permissions. Other platforms report computer control unavailable.
- AI SDK tools: desktop_access_status, desktop_screenshot, desktop_computer_action. Only read tools are exposed in Plan. Existing custom-agent tool allowlists remain authoritative; new desktop tools can be selected in the agent profile editor.
- A model must receive a fresh screenshot before each input. Lost acknowledgement consumes the observation and reports outcome_unknown; input is not automatically replayed. Native relay request IDs also deduplicate inputs.
- Captures use private temporary directories and bounded JPEG transfers. Pixels are supplied once as a multimodal tool result, not included in the persisted JSON output. Computer grants end on sign-out or native app exit.
- File-sharing status no longer says “No computer access” when no files are shared; device access is a separate capability.

## Verification

- 86 tests across seven focused suites: connection lifecycle, native relay adapter, lost acknowledgement, input observation rules, public/loopback browse policy, settings UI.
- 20 integration tests: main tool factory/profile policy, Plan boundary, settings composition.
- 1 native capability contract test: main webview scope and command permission lists.
- 40 Rust tests, including a real owned TCP localhost fixture with no file grants and access revocation.
- TypeScript check passed; Next production build passed.
- Native UI-preview build and ad-hoc code-signature verification passed.
- Actual RIFT Desktop UI shows enabled Connect buttons for Local websites and Computer control. No native command error remains.

The first incremental native build contained new handlers but a stale compiled ACL manifest, causing “desktop_access_status not allowed. Command not found”. Cleaning only the rift-desktop Cargo package and rebuilding corrected the native permission table; verified in the actual desktop application. Dependencies, workers, and user data were not cleared.

Three unrelated existing assertions in the broad desktop-release-contract suite describe older launch-loader/font/Cargo source forms. The targeted access capability contract passes; the entire broad suite is not claimed green.

## Running versions and remaining live verification

- Native app: dist/RIFT UI Preview.app, same bundle ID, frontend localhost:3020. Previous native executable retained at /tmp/rift-desktop-before-device-access-20260908.
- Production frontend: localhost:3022, .next-device-access-release, started with start:ui-release-preview. HTTP 200 verified. Log: /tmp/rift-device-release-server.log.
- Dev frontend and agent worker were not restarted.
- Device grants have not been activated for the user's real screen. Live Cloud→Mac relay and actual mouse/keyboard tests still require the requested user approval and macOS permissions. No claim of completed end-to-end PC control yet.
- A normal browser tab has no Tauri IPC; the same-account RIFT Desktop app must stay open for device access. Public page reading does not have that dependency.
- Localhost HTML reads do not share browser cookies or reproduce a logged-in SPA screen. Visual inspection of that screen uses the separately consented computer connection.
