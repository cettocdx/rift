# Native navigation and reconnect races

## Reproduced failures

1. A successful cancellation response arriving after navigation stopped the current conversation's local reader and activity.
2. An unsuccessful cancellation response arriving after navigation displayed its error in the unrelated current conversation.
3. Two history requests for the same conversation, separated by navigation, allowed the older response to replace the newer response because conversation identity alone was insufficient.
4. A reconnect that found a completed server run fetched the newest history page and replaced all loaded history, deleting older messages from the visible transcript and resetting its pagination cursor.

## Fixes

- Cancellation captures conversation and execution identity before awaiting the request. Both success and error paths update UI only when those identities still match. A new conversation resets its cancellation identity.
- Opening history also captures the pagination generation. Success and failure from an older open cannot overwrite a later open of the same conversation.
- Completed-run refresh replaces the newest page suffix, preserving already loaded older messages and their pagination cursor.
- Navigation continues to detach only the local reader; no new cancellation endpoint is called when changing screens.

## Evidence

- Three delayed-network race cases failed before fixes (`/tmp/rift-ios-navigation-race-red.log`); the first corrected unit suite passed (`/tmp/rift-ios-navigation-race-green.log`).
- Completed reconnect test failed with missing older text and wrong cursor (`/tmp/rift-ios-reconnect-history-red.log`).
- Final native and navigation suite: `/tmp/rift-ios-navigation-recovery-green.log` (completion recorded below).

These tests use real URLSession requests intercepted by a test URLProtocol with controlled response ordering. They establish client state behavior, not survival of a real production worker or correctness of provider infrastructure. Long live background runs, real generated previews and physical-device lifecycle testing remain separate acceptance requirements.

Final suite passed: 60 unit tests + 4 navigation XCUITests, zero failures. xcresult: `/tmp/rift-ios-final-derived/Logs/Test/Test-RIFT-2026.09.17_11-24-08-+0300.xcresult`. Build 5 archive and upload pending.

## Build 5 release receipt

Archive `/tmp/RIFT-TestFlight-0917-build5.xcarchive` completed. Production origin, four iPad orientations, encryption declaration, version and strict signature verified. Source manifest `/tmp/rift-ios-build5-source-manifest.json`; only RIFTStore.swift differs from shipped build 4. Upload completed successfully at 11:28:19 (`/tmp/rift-testflight-0917-build5-upload.log`, exit 0); package processing at Apple. Internal testing still pending on first group recheck.

Apple follow-up: build 0.1.0 (5) upload Complete, RIFT Internal has 1 tester / 4 builds, and build 5 is Testing with 90 days remaining. Physical-device installation is not yet observed.
