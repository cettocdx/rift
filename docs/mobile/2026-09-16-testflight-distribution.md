# Native TestFlight distribution status

- Bundle: `app.riftsys.ios`, version 0.1.0 (1), team KWYUUGT7D9.
- Release archive succeeded at `/tmp/RIFT-TestFlight.xcarchive`.
- App Store export succeeded at `/tmp/rift-testflight-export/RIFT.ipa`.
- Release server URL verified from archived Info.plist: `https://riftsys.app`.
- Upload attempts failed with “App Store Connect access ... is required”. Xcode account reauthentication is required; signing/export success does not prove upload access.
- Apple Developer agreement warning cleared after account-holder action.
- App Store application creation was submitted, but session expired before confirmation. Check existing apps before attempting creation again.
- Production mobile session endpoint still returned 404 before backend deployment.
- A production-environment deployment with `--skip-domain` is building at `https://rift-601bz3qz6-tddd8m7bjm-7313s-projects.vercel.app`. No domain promotion has been performed.
- Do not report TestFlight availability or Mac-independent task execution until upload processing, tester assignment, backend checks and authenticated phone use are verified.

## Follow-up

- Cloud build completed successfully (`READY`).
- Pre-promotion checks: home 200; mobile session, console config and unauthenticated mobile stream all 401, as expected.
- Promoted deployment `dpl_69h639AQ2cFthJfGiZ3sVB2zggzi` to the production domains successfully.
- Verified `https://riftsys.app/api/mobile/session` now returns 401 JSON rather than 404.
- Authenticated task execution on this cloud deployment remains unverified; endpoint availability alone does not prove worker/schema compatibility.
- Retried Xcode upload; same App Store Connect account access error. Reauthentication window is open for the account holder.

## App registration

- Created App Store Connect app `6812872136`, name `RIFT — AI Workspace` (plain `RIFT` was unavailable), SKU `rift-ios-001`, bundle `app.riftsys.ios`.
- Device display name remains RIFT.
- First post-registration upload hit an Xcode ITunesSoftwareService connection error. One retry started upload successfully; final result pending.
- Upload succeeded at 21:37 local time; xcodebuild returned 0 and `Uploaded RIFT / EXPORT SUCCEEDED`. Apple package processing is pending. Log: `/tmp/rift-testflight-upload-service-retry.log`.
- Created `RIFT Internal` group with automatic distribution and added the account holder as its sole tester. Current status: `No Builds Available` while processing completes.

## 17 September — processing rejection diagnosed

- App Store Connect still showed zero builds, including the app-level build list.
- Read the account's App Store Connect notification: build 0.1.0 (1) was rejected with `ITMS-90474`, missing `UIInterfaceOrientationPortraitUpsideDown` for iPad multitasking. This supersedes the earlier pending-processing status.
- Added all four orientations under `UISupportedInterfaceOrientations~ipad` in `project.yml`, regenerated the project and Info.plist, and incremented the build to 2. iPhone orientations remain unchanged.
- The prior archive fails the iPad orientation check; the new source and actual build 2 archive pass.
- Current-source Release archive succeeded: `/tmp/RIFT-TestFlight-0917-build2.xcarchive`.
- Verified archived bundle `app.riftsys.ios`, 0.1.0 (2), both iPhone/iPad device families, production server `https://riftsys.app`, four iPad orientations, and strict code-signature verification.
- Native tests and re-upload validation are in progress; archive success alone does not establish TestFlight availability.
- Native tests completed: 49 tests, zero failures, `TEST SUCCEEDED` (`/tmp/rift-testflight-0917-build2-tests.log`).
- Build 2 upload succeeded at 09:36:16 local time on 17 September: `Uploaded package is processing`, `Upload succeeded`, `EXPORT SUCCEEDED`, exit 0 (`/tmp/rift-testflight-0917-build2-upload.log`).
- The immediate post-upload App Store Connect build list remains empty. Processing acceptance and tester availability are not yet verified.

## Build 2 available for internal testing

- Apple processing completed successfully. Build upload list shows build 2 `Complete`; build 1 is explicitly `Failed`.
- Completed the encryption questionnaire based on native source/dependency inspection: URLSession and system Keychain only; no separately implemented proprietary or standard cryptography. Selected `None of the algorithms mentioned above` and saved.
- Build UUID: `7edf2e86-66df-431e-b16a-537a0cf858e5`.
- Verified `RIFT Internal`: **1 tester, 1 build**; **0.1.0 (2), Testing, Expires in 90 days**.
- Account holder `ahmetcet92@hotmail.com` is **Invited** (17 September), replacing `No Builds Available`.
- Chrome remains open to the group's Builds page. Physical iPhone installation and authenticated use are not established by this distribution verification.

## Build 3 — native Activity and Preview

- Added native Activity/Preview navigation, persisted Build preview handling, media-generation stage rendering, structured tool evidence, reasoning-only history retention and Hack target propagation. Detailed receipt: `2026-09-17-native-activity-preview.md`.
- 55 native tests and one panel/draft XCUITest passed with zero failures.
- Build 0.1.0 (3) archived successfully at `/tmp/RIFT-TestFlight-0917-build3.xcarchive`; signature, production origin and iPad orientations verified.
- `ITSAppUsesNonExemptEncryption=false` matches the system-only encryption declaration already accepted for build 2; the app's isolated preview WebKit does not add custom cryptography.
- Upload started; log `/tmp/rift-testflight-0917-build3-upload.log`. Do not equate upload start with Apple acceptance or tester availability.
- Build 3 upload succeeded at 10:40:05 local time. Apple processing is **Complete**; build UUID `3726d908-f76d-49d9-a8c0-2d2cf860ab75`.
- Verified RIFT Internal group: 1 tester, 2 builds; **0.1.0 (3) — Testing, expires in 90 days**. No additional compliance prompt was needed.
- Apple now reports account holder has **Installed 0.1.0 (2)** on **iPhone 17 Pro Max / iOS 26.6.1**. Build 3 availability is verified; its installation and live task acceptance are not yet established.

## 17 September — Build 4 compact native controls

Build 0.1.0 (4) includes transcript-tap keyboard dismissal, compact navigation symbols with preserved touch targets, and a fixed model sheet with pinned Studio media tabs. Verification: 56 unit tests plus 4 navigation XCUITests passed; the final opaque sheet background passed its additional layout check.

Archive: `/tmp/RIFT-TestFlight-0917-build4.xcarchive`; source manifest `/tmp/rift-ios-build4-source-manifest.json`. Strict signature, production origin and build metadata verified. First upload failed due to a network timeout; Apple had no build 4 record on recheck. The same archive uploaded successfully on retry (`/tmp/rift-testflight-0917-build4-upload-retry.log`, exit 0). App Store Connect shows Processing at 11:15. Follow-up verified upload Complete and build 0.1.0 (4) Testing in RIFT Internal (1 tester, 3 builds, 90 days remaining). Physical-phone installation not yet observed.

## 17 September — Build 5 navigation and reconnect fixes

Build 0.1.0 (5) isolates delayed cancellation/history responses to their originating conversation and execution, and preserves previously loaded history after reconnecting to a completed run. 60 native tests and 4 navigation UI tests passed. Archive `/tmp/RIFT-TestFlight-0917-build5.xcarchive`, source manifest `/tmp/rift-ios-build5-source-manifest.json`. Upload succeeded at 11:28:19 (`/tmp/rift-testflight-0917-build5-upload.log`). App Store Connect independently verified Complete and RIFT Internal Testing, 90 days remaining, 1 tester / 4 builds. Physical installation not yet observed.
