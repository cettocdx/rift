# Native compact controls and keyboard dismissal

## Changes

- Tapping the transcript dismisses composer focus through a simultaneous tap gesture. The composer itself remains outside that gesture; scrolling still dismisses the keyboard interactively.
- Navigation symbols use a 16-point medium font and retain 44-point hit targets. On iOS 26, automatic shared glass backgrounds are hidden; iOS 18–25 retain supported native toolbar behavior.
- Opening model selection dismisses composer focus. The sheet is owned by the workspace instead of the model button.
- Model selection has one 65% height detent and scroll-first interaction. Studio's Image/Video segmented control stays above the scrolling model list. An opaque system background prevents transcript text showing through the sheet.

## Evidence

- Before fixes, transcript tap did not dismiss the keyboard (`/tmp/rift-ios-keyboard-red.log`), and the presented native model sheet had two height detents (`/tmp/rift-ios-picker-red.log`).
- After fixes: 56 native tests and four navigation XCUITests passed, zero failures. Log: `/tmp/rift-ios-compact-ui-green.log`.
- UI tests cover keyboard dismissal with draft retention; Activity/Preview open-switch-close with draft retention; three repeated Studio/Hack/Build navigation cycles; and Studio template insertion without submitting a task.
- xcresult: `/tmp/rift-ios-final-derived/Logs/Test/Test-RIFT-2026.09.17_10-56-37-+0300.xcresult`.
- Screenshots inspected in `/tmp/rift-ios-compact-ui-screens`: compact toolbar and preserved draft (`2D19CD77-F35B-4648-B277-82714EE727D0.png`), fixed model picker (`9F1DD4C6-7CC1-4141-AEF0-AE5E08B52305.png`). The latter prompted the final opaque-background cleanup; that final check is recorded below.

## Scope and remaining acceptance

These are iOS simulator checks, not physical-device or live backend acceptance. Model sheet layout uses fixture catalog entries. Running-project previews, live generation, long task recovery and desktop blank-webview diagnosis remain separate work. No worker restart, server prompt promotion, or real security task was performed as part of this change.

Build 4 upload succeeded on retry. App Store Connect subsequently completed processing; RIFT Internal now shows 0.1.0 (4) as Testing with 90 days remaining.

## Final visual cleanup and archive

- Opaque model-sheet background check passed: `/tmp/rift-ios-picker-opaque-green.log`; final screenshot `/tmp/rift-ios-picker-opaque-screens/466F07A8-9C98-4E77-BD1B-16788D25EE8A.png` inspected, underlying text no longer visible.
- Build 0.1.0 (4) archive succeeded at `/tmp/RIFT-TestFlight-0917-build4.xcarchive`. Verified production origin, version, four iPad orientations, encryption declaration and strict signature. Source manifest `/tmp/rift-ios-build4-source-manifest.json`; compared to build 3, only WorkspaceView.swift and NativeModelPicker.swift changed.
- First upload failed with network offline/ASSET_UPLOAD response timeout (`/tmp/rift-testflight-0917-build4-upload.log`, exit 70). App Store Connect rechecked: no build 4 entry in Build Uploads or internal group. Retrying the same archive, log `/tmp/rift-testflight-0917-build4-upload-retry.log`; not yet an Apple acceptance receipt.

- Retry completed with `EXPORT SUCCEEDED` and Upload succeeded at 11:15:02. App Store Connect independently confirms build 0.1.0 (4), Processing, created 17 September 2026 11:15.

## Distribution receipt

App Store Connect independently verified: build 4 upload Complete, RIFT Internal group has 1 tester / 3 builds, and 0.1.0 (4) is Testing with 90 days remaining. User installation on a physical phone is not yet observed.
