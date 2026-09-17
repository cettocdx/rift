# Desktop release and mobile follow-up

## Maintenance diagnosis

Read-only recheck of the main environment on 17 September found 405 claims: 397 released and 8 active. Of the eight provider lookups, seven were identity-matching terminal runs (completed, canceled, crashed or failed); one returned 404. The HTTP inventory has 39 records: 37 terminal, one stopped, one running. This is insufficient producer-exit evidence for a forced restart. No claims were deleted or released and no main server/worker was terminated.

Preparing the canonical production desktop app, which loads the already published `https://riftsys.app/login`, without stopping the localhost preview service. Build uses `packages/desktop`, the default configuration, `/tmp/rift-canonical-desktop-target`, and two Cargo jobs. Log: `/tmp/rift-canonical-desktop-build-20260917.log`. Build is not yet verified complete or installed.

Desktop loader, startup, layout and download-gate tests passed: 21/21, zero failures. Log: `/tmp/rift-desktop-release-tests-0917.log`.

## Mobile recording review and authenticated packaged UI

Reviewed the supplied `ScreenRecording_09-17-2026 02-55-17_1.MP4`; sampled contact sheet at `/tmp/rift-mobile-web-0917-contact.png`. The recording shows the old blue New chat action and a preview remaining in Checking preview. These remain reproduction context, not evidence about the current release.

Tested the current immutable package on port 3082 with the existing signed-in account, on completed conversation `0f7e56eb-be06-4ec5-9aa5-d6ad3b62bede`. No task, tool call or duplicate message was submitted.

- At 390×844, navigation opens/closes. New chat is neutral: dark theme background rgb(243,243,243), text black; light theme background rgb(17,17,17), text white. Actual button height 44px, text 17px.
- Selecting light theme updates the theme-color meta to #ffffff. No document horizontal overflow.
- Show agent activity opens a full-screen RIFT computer dialog at x=0,y=0,width=390,height=844.
- Selecting the recorded command opens terminal details and renders its actual /home/user and RIFT_TERMINAL marker output.
- Closing the panel restores the conversation, including its final response.
- At 390×500, the Activity dialog remains exactly 390×500 without horizontal overflow. After closing, Message RIFT can receive focus at y=373–433, within the 500px viewport.
- No captured browser console errors during this check. Temporary viewport override was reset and the original dark theme restored.

Limits: in-app browser viewport testing uses a fine pointer; it does not emulate physical iPhone touch, Safari software keyboard zoom, or native safe-area values. The 13px fine-pointer composer does not prove the coarse-pointer iPhone rule. Preview availability and physical-device keyboard behavior need separate evidence. Canonical desktop currently has an ad-hoc signing configuration; Apple-trusted desktop distribution remains incomplete.

## Canonical desktop installation follow-up

- Canonical desktop build completed successfully (20m05s) and 21 release/loader tests passed.
- Installed `/Applications/RIFT.app`; prior package preserved at `/Users/cetto/RIFT-Release-Backups/RIFT-before-20260917.app`.
- Installed executable SHA256: `367e4bfd831d41dd6c7c269ed27a2c459e3dbeaae289a93ca8444f0d9807cffb`. Strict ad-hoc signature verification passed; not notarized. Public DMG was not replaced.
- Live acceptance uncovered intermittent blank main webview. A single Cmd+R showed the authenticated production workspace, but blank state recurred. No task was submitted; cause remains unresolved. Do not treat installation as passing full desktop acceptance.
- Latest user steering prioritized native iOS missing Activity/Preview/Studio progress/Hack execution. See `docs/mobile/2026-09-17-native-activity-preview.md`.

## Visual recheck at 11:13

The installed desktop app visually renders Hack Workbench and a completed response. Its native accessibility tree contains only window controls and the menu bar; that empty web accessibility tree must not be used as proof of a blank rendered page. No task or navigation was triggered during this check. Screenshot: `/var/folders/wx/z8k5q55n7p3_xclljxndysv80000gn/T/codex-shot-2026-09-17_11-13-45.png`. This one visible frame does not prove the earlier intermittent rendering symptom resolved.
