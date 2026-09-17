# Native mobile workbench verification

Implemented: compact scope header; searchable 50-preset desktop task catalog; selection prepares draft without executing; Hack requests use agent mode and scope; separate scope per conversation in memory; Studio and Build brand assets including all media provider mappings.

Verification: 17 native unit tests passed, including catalog uniqueness and UIKit asset loading for every mapped provider. XCUITest repeated Studio → Hack → Build three times, selecting Passive OSINT and checking draft contents each time, passed. Final native build includes scope isolation added after that navigation run.

Not yet verified: actual remote security execution/cancel/resume, paid Studio generation, iPad layout, physical-device lifecycle, visual correctness of every logo. Native Hack is not yet full desktop parity: structured findings/evidence/report export and attachment upload are still missing. Scope restoration currently lasts for this app process, not app relaunch. Do not report full mobile acceptance or desktop parity based on navigation tests.

## Follow-up

Added native file importer using existing authenticated storage actions; rejected client privilege overrides; restored saved file metadata; download bytes before iOS sharing; assessment transcript export and severity-tagged evidence disclosures. These disclosures preserve reported evidence, not independent verification of findings.

19 native unit tests and 12 mobile API tests passed. TypeScript check passed. Full UI pass found a keyboard assertion reading only the first character; isolated recheck pending. Repeated workspace navigation passed in that full run. No iPad simulator is configured. Live authenticated acceptance is pending user login; no paid generation or remote security execution has been claimed verified.

Settings presentation moved out of the conditional drawer. The focused Settings-dismissal → new chat → keyboard test passed after asserting actual dismissal. Live Build request completed and showed RIFT_MOBILE_OK_915 in the native transcript (screenshot /tmp/rift-live-build-status.png). The first live test expected a trailing period and therefore timed out despite successful completion; fixed its matcher, no latency claim from that run. 15 mobile API tests now pass, including file metadata restoration without storage keys.

Studio live call 50034D82-8DCE-4F34-BFCB-8E9EEFA8C935 completed server-side with one image tool call (143636 ms stream duration, persisted PNG). Native UI did not render the file because it consumed metadata broadcasts but ignored durable file IDs in tool output. Added shared result extraction and identity dedup tests. Do not regenerate for validation: reopen saved conversation and download its existing result. Normalized SVG root dimensions from em to 24px for Apple asset compilation.

Landing replacement first pass: /landing/action, separate from public homepage until responsive and navigation review completes. Reference visually inspected at composio.dev. New illustration labels explicitly distinguish walkthrough from a real running task.

Verified recovery: testSavedStudioArtifactDownloadsWithoutRegeneration PASSED at 02:03 local time; reopened existing Ceramic Sphere Image Request and downloaded the persisted file to iOS temporary storage, exposing Save or share. Log /tmp/rift-studio-download-check2.log. No second generation was dispatched. Media file reducer suite now 21 unit tests passed. Live-stream rendering fix is unit-tested; end-to-end recovery verified from persisted history.

## Hack native acceptance — 2026-09-15 02:27

The native live test exposed two request-contract defects: it always selected the durable Hack endpoint although this deployment has that feature disabled, and it omitted the HTTP assessment execution identity used by the web workbench. Mobile now selects the existing authorized Hack handler before dispatch using the same rollout flags as web, supplies a stable execution ID, and uses the returned transport to select the corresponding cancellation endpoint. A rejected durable request is never retried as a direct task.

The original 400 happened before model execution. The subsequent native test also exposed an intermittent composer focus failure; the input now has a 44-point tap area and explicit focus on tap.

Evidence:

- `/tmp/rift-mobile-api-final.log`: 19 API tests pass, including four new routing/replay regressions.
- `/tmp/rift-hack-identity-test.log`: 23 native unit tests pass; its UI attempt failed before sending because of focus.
- `/tmp/rift-hack-final-live.log`: live native Hack test passes after the focus fix. Prompt reviewed hypothetical debug/cookie configuration only; no tools or networks requested. Assistant completion marker, finished state, report opening and enabled report export verified.
- Run chat `5D9C3322-8E67-4F38-B426-665FDADFD72D`: POST 200, server stream 13,714 ms, finish reason stop, outcome success. This is end-to-end completion time, not first-token latency.
- This live test used the deployment's direct Hack path. It does NOT establish worker-crash or durable Hack recovery acceptance.

A further correctness issue was observed: the mobile Build selector displayed Sol while the existing security route intentionally executes Grok. The mobile configuration now publishes the actual fixed security model separately, so the native Hack selector no longer advertises ignored Build choices. Final model-catalog build verification follows in `/tmp/rift-mobile-model-tests.log` and `/tmp/rift-mobile-model-types.log`.

## Chunked replay stability — 2026-09-15 02:32

Found a visible-response regression in StreamTextReducer: the first replay delta replaced an entire saved answer, causing the answer to shrink/disappear before being rebuilt. Added tests that reproduce this with multiple prefix chunks and verify authoritative completion can correct a stale longer snapshot. Both new cases failed before the change (`/tmp/rift-replay-before.log`).

Reducer now accumulates each replay part independently, preserves the visible matching prefix until replay catches up, and reconciles the final text on text-end/finish. Existing persisted-history deduplication and separate-message tests remain passing. All 25 native unit tests pass after the change (`/tmp/rift-replay-after.log`); diff whitespace check passes. This verifies text replay semantics, not a live worker-kill/recovery scenario.

## Live Build recovery after native process termination — 2026-09-15 02:36

Added opt-in `testBuildContinuesAfterAppTermination` and stable conversation accessibility identifiers. The test submits one read-only wait/print command, grants its approval, terminates the native application while the server run is executing, relaunches it, opens the same conversation by ID, and checks the final marker appears exactly once and the composer returns to Send.

Evidence:

- `/tmp/rift-native-recovery-live.log`: TEST SUCCEEDED; termination at test t=48.71s, relaunch at t=49.75s, final test pass at t=98.869s.
- Chat `1F633A6D-698A-403D-B12D-44E547A9CCB0`, run `run_06ga4hjpn1d3qqu5sekm62c401`.
- Trigger authoritative status queried EXECUTING during the test, then COMPLETED with finishedAt 2026-09-14T23:36:39.595Z.
- Backend logs show one initial dispatch, then GET resume for the same chat. No second dispatch observed.
- Owner-checked persisted transcript queried after completion: one user turn, one assistant run message, exactly one `tool-run_terminal_cmd` (`call_ndV5xwV7EMOHn4J12pOKk7BB`) in output-available state, command `python3 -c 'import time; time.sleep(45); print(12345)'`, and final `RIFT_RECONNECT_COMPLETE` text.

This proves one native client-process termination/reopen scenario with a live Cloud Build task and no duplicate command in the persisted trace. It does not prove worker process death, arbitrary network outage, multi-hour workloads, or equivalent Studio/Hack recovery.

## Studio file preview/download resilience — 2026-09-15 02:50

NativeArtifactView now handles AsyncImage failure with an explicit Retry preview action, refreshes the owner-checked signed URL on every explicit download attempt, preserves a single AVPlayer instance across view redraws, and pauses playback off-screen. Image preview reserves a square viewport before loading to avoid moving the download action when the image arrives. Download action has a 44-point hit area and stable file accessibility ID. Non-image files remain downloadable without requiring a preview.

Verification:

- Initial 25 native unit tests pass in `/tmp/rift-studio-refresh-check.log` (its UI attempt failed).
- The first UI attempt missed its action during layout. The next attempt's XCTest trace explicitly targeted an off-screen first-match button; the test now selects a visible download and uses its stable ID.
- `/tmp/rift-studio-visible-download.log`: existing saved Studio artifact opened, downloaded, Save or share appeared; TEST SUCCEEDED. Backend shows refreshed `/api/mobile/file` GET for the chosen existing file. No image generation request made.
- Native build and diff whitespace check pass.

Retry code paths were inspected, but forced expired-link/network-failure and video-playback acceptance are not yet live-tested. Successful download does not establish those cases.

## Compiled model-logo rendering — 2026-09-15 02:55

Investigated the tiny Gemini logo by rendering UIImage from the actual compiled asset catalog into an XCTest attachment. The image reported 24×24 points but displayed only a small fragment of the original star, proving an SVG compilation/rendering issue rather than SwiftUI frame sizing. OpenAI rendered correctly in the same probe.

Preserved original SVGs in `packages/ios/BrandSources`; `packages/ios/scripts/build-provider-assets.cjs` renders explicit 24/48/72-pixel Retina PNG assets using sharp. All provider image sets now use those images; monochrome brands retain template rendering in ProviderLogo. No brand artwork was redesigned.

`/tmp/rift-provider-retina.log`: three model/catalog tests passed and native build succeeded. Exported compiled Gemini artwork in `/tmp/rift-provider-retina-art/3498EA63-4B6A-4C87-AC1A-A43F2474208C.png` visually confirms the complete colored star. Original broken render is in `/tmp/rift-provider-artwork/F803B5C3-2BBD-44A5-B551-ECFFCD88F56C.png`. Diff whitespace check passed.

### Saved activity and reconnect classification

- Native history now restores public tool activity from persisted assistant parts, preserves completed/failed outcomes, and marks unconfirmed input as interrupted until live evidence arrives. Raw reasoning is not included.
- HTTP validation, authentication, credit and rate-limit rejections no longer advertise reconnecting to an unstarted task. Ambiguous gateway/timeout responses still allow checking saved execution without resubmitting commands. Explicit stream error events do not advertise a transport reconnection.
- `/tmp/rift-activity-restore.log`: 27 native tests passed.
- `/tmp/rift-reconnect-policy.log`: 28 native tests passed; simulator build and ad-hoc signing succeeded. App relaunched on EBA4F02D-69B9-4608-9935-31F257E77239.
- These are native regression checks, not evidence of worker-death or multi-hour resilience. Live error-path acceptance and historical activity visual checks remain pending.

### Saved Build activity: live acceptance and older message paging

- `/tmp/rift-saved-activity-live.log`: native UI reopened saved recovery conversation 1F633A6D-698A-403D-B12D-44E547A9CCB0, expanded activity, verified RIFT_RECONNECT_WAIT had Completed accessibility status and no Stop task control. Passed in 16.395 seconds; no new model execution.
- Added native Show earlier messages using the existing authenticated cursor API. Pages prepend without duplicate IDs or replacing newer live text. Generation checks discard responses after switching chats; errors remain retryable. Scroll restoration targets the prior first message, and activity placement is offset by the added count.
- `/tmp/rift-message-pages.log`: 29 native unit tests passed, including page order, file preservation and overlapping-page/live-text preservation. Build/signing succeeded.
- Multi-page live scrolling remains to be visually accepted; unit success alone does not establish scroll stability or full historical tool-activity coverage. Only latest assistant activity is restored currently.

### Per-message activity restoration — implementation awaiting Xcode

History decoding now emits a stable activity row for every assistant message, including tool-only turns. User parts cannot create activity rows. Older-page merging deduplicates these rows by message identity. The prior single latest-assistant restoration was removed; live replay suppresses only matching tool IDs in historical rows, preserving unrelated earlier evidence without duplicating replayed calls.

Added regression cases for multi-turn/tool-only placement, user-part exclusion, page deduplication and non-mutating live-call filtering. `git diff --check` passed. Native tests did NOT run: `xcodebuild` exited with the Xcode/Apple SDK license acceptance requirement (`/tmp/rift-all-activity-tests.log`). Account owner must review/accept the agreement before simulator build/test. This implementation is not yet claimed verified or installed.

### Saved media chronology

Inspection found that NativeMessageHistory decoded all text parts before all fileDetails, moving commentary written after an image above that image when reopening a chat. Decoder now traverses persisted text/file/successful tool-output parts in order, resolving file metadata by durable ID and deduplicating repeated file references. Metadata-only legacy files append as before because their chronological positions are unknown. Added regression for text → generated image → commentary with duplicate file metadata.

`git diff --check` passed. Native compilation/tests remain pending Xcode license acceptance; these changes are not yet installed or claimed visually verified.

Cross-surface server checks at this point: 147 tests across nine mobile-session/upload/stream, GitHub-return and durable start/resume/cancel/receipt suites passed (`/tmp/rift-cross-surface-regression.log`). This is route-level coverage, not real-device acceptance or proof of complete OAuth/native parity.

## Live activity retained between turns (source change, pending native execution)

The send path cleared agentActivity before saving the previous turn; its tool timeline vanished when the next message was submitted. NativeActivityHistory now freezes that activity at its previous conversation position before appending the next user message. Existing saved tool IDs are excluded so reconnect/replay does not duplicate them. Three tests cover chronology, partial replay deduplication and empty activity. Xcode license acceptance still blocks compiling/running these tests. This fix is not installed or live-verified.

## Mobile file endpoint acceptance coverage

Added direct `/api/mobile/file` regression coverage: signed-out requests never
resolve storage, invalid IDs fail before storage, client privilege parameters
are ignored, unavailable owner-filtered results return 404, each explicit
attempt resolves a fresh signed URL with private/no-store, and a storage error
returns 503 without internal details while a later retry can succeed.

These route tests and the existing S3 action tests passed together: 55 tests
across two suites (`/tmp/rift-mobile-file-access-tests.log`). The S3 suite
includes rejecting other-owner files. This is backend regression coverage,
not a forced-expiry SwiftUI download or native share-sheet acceptance test;
those remain pending native build availability.

## Xcode 27 restored — 2026-09-15 midday

- Xcode 27.0 (27A266a), ad-hoc signed native SwiftUI build, installed iOS 26.5 simulator. This is not validation on an iOS 27 runtime.
- 35 native unit tests passed, including message/activity restoration and media order.
- Repeated Build/Studio/Hack navigation passed (three rounds). Keyboard/settings navigation passed with Device Hub open; the initial headless keyboard run failed and is retained in `/tmp/rift-ios-navigation-restored.log`.
- Live Build response passed; visible response took 24.336 seconds including XCTest observation. This does not meet the startup performance target.
- Live Hack fixture review and report opening passed. No external scanning was performed.
- Saved Studio download passed in 32.295 seconds after correcting the UI test's element type and targeting the known artifact-bearing conversation ID instead of its non-unique title. Evidence: `/tmp/rift-ios-studio-approved.log`.
- Fresh Studio testing exposed a 120-second idle URLSession timeout while awaiting tool consent. The mobile Studio POST/replay proxy now sends SSE comments at idle frame boundaries, using the existing cancellation-safe heartbeat adapter. It preserves authorization rejections and 204 responses, does not dispatch retries, and avoids inserting comments inside fragmented events.
- Heartbeat regression was first observed failing, then 17 tests passed (mobile routing and heartbeat adapter). Targeted lint passed. Fresh Studio generation, explicit approval, download and native ShareLink availability passed (108.034 seconds total test time). Both Studio tests passed in `/tmp/rift-ios-studio-approved.log`. This does not test a specific external share destination or prove all provider failures eliminated.

### Final native recovery and navigation

The first recovery run stopped before dispatch: XCTest tapped the blank portion of the plain Build row but the drawer remained open (composer x=412, outside the viewport). Added `contentShape(Rectangle())` to full workspace and conversation rows, retaining the same recovery test and assertions.

- `testBuildContinuesAfterAppTermination`: passed, 120.311 seconds. Reopened conversation `753B1DCF-277F-49F6-AE2B-4188B4BBEFB1`, saw completion once and Send available. This is client recovery evidence; not an independent server-side audit of every command execution.
- `testRepeatedWorkspaceNavigationAndTaskDraft`: passed, 71.481 seconds, three rounds across Studio/Hack/Build.
- xcresult: `/tmp/rift-ios-final-derived/Logs/Test/Test-RIFT-2026.09.15_12-37-23-+0300.xcresult`; log `/tmp/rift-ios-recovery-row-hit.log`.
- Targeted TypeScript check and ESLint passed. Final routing/heartbeat tests: 17 passed.

Remaining acceptance scope: physical iPhone/iPad, iOS 27 runtime, background suspension/airplane mode, long approval waits against the actual deployed proxy, full native account/provider sign-in and GitHub/project flows, accessibility and release signing. The successful fresh Studio test approved promptly; it does not by itself prove >120-second human approval waiting. The idle keep-alive behavior is covered by deterministic regression tests.

### Long approval wait verified, then mobile policy changed by the user

The real Studio test kept the approval pending for 130 seconds (longer than the configured 120-second request idle timeout), observed no reconnect/timeout UI, then approved, generated and downloaded the image successfully. Evidence: `/tmp/rift-ios-studio-idle130.log`, xcresult `Test-RIFT-2026.09.15_12-43-56-+0300.xcresult`.

The user subsequently requested all mobile workspaces always run freely. The shared native dispatch now explicitly sends `approvalMode: full` for Build, Studio and Hack. It does not change the separate Hack `mode: agent` / Studio `purpose: image` routing. Server account/project authorization and operating-system privacy prompts remain effective. The live Studio and Build recovery tests now assert no Allow prompt appears; testing this revised policy is in progress in `/tmp/rift-ios-full-access.log`.

Studio with the new full-access policy passed generation and download in 78.153 seconds with no Allow button. Build began without an approval, but its recovery test then missed the menu target; a subsequent attempt missed Send and left the draft unchanged (screenshot `/tmp/rift-full-build-state.png`), so neither attempt is claimed as recovery success. The test now uses element-relative center taps, as the existing native navigation acceptance test already does. The command/recovery assertions are unchanged. Final rerun: `/tmp/rift-ios-full-build-center.log`.

Final full-access Build recovery rerun passed (102.419 seconds), with no Allow prompt, process termination/relaunch, saved conversation reopen and one visible completion. Evidence: `/tmp/rift-ios-full-build-center.log`, xcresult `Test-RIFT-2026.09.15_12-56-24-+0300.xcresult`. Studio full-access generation/download had already passed. Hack uses the same native dispatch policy and its server adapters preserve the supplied approval mode; a separate full-access live Hack tool execution was not run in this policy-change pass.

## Full-access Hack tool evidence

Live Hack completed the hypothetical configuration review without an Allow prompt. The original UI assertion missed activity above the viewport, and saved replay briefly exposed two controls with the same semantic identifier (disabled live Working and expandable Previous activity). The test now scrolls the transcript and targets an enabled activity control.

Saved conversation `44775975-1281-4B1A-9BF3-6CAA954EE88F` verified: **Native Hack tool check / Completed**. Test passed in 35.067 seconds, without generating another answer. Evidence `/tmp/rift-ios-hack-saved-enabled.log`, xcresult `Test-RIFT-2026.09.15_13-18-16-+0300.xcresult`. Backend receipt reports success, one tool call, no abort/preemptive timeout for the same conversation. This was the read-only `printf RIFT_HACK_TOOL_OK` fixture, not an external scan.

Composer now dismisses the keyboard after sending to expose more of the task and response. This source change compiled in the saved-history test; its send behavior needs the next live navigation pass.

## Native response formatting

NativeAssistantText previously rendered each non-question segment as plain Text(String). It now renders inline Markdown through Foundation, preserving paragraph whitespace and link/emphasis attributes, and separates fenced code into selectable, horizontally scrollable monospace blocks. Existing structured question cards remain separate and ordered. Incomplete fenced code remains visible while streaming. Same-line triple-backtick spans are kept as inline text rather than discarded as a block opening.

The first native build/test run passed all 38 unit tests, including formatting, code preservation and fence length cases: `/tmp/rift-ios-markdown-tests.log`, xcresult `Test-RIFT-2026.09.15_14-33-32-+0300.xcresult`. A follow-up focused run adds the same-line span regression; `/tmp/rift-ios-markdown-final.log` is the authoritative result. The captured launch screen does not show a formatted response and is not visual proof of Markdown rendering. Full block Markdown (tables and headings), physical-device rendering and accessibility review remain open.

The follow-up native test process exited successfully. The delayed simulator screenshot was entirely black, so it supplies no visual acceptance evidence; a fresh rendered conversation inspection is still required.

### Rendered formatting evidence

The 10-case parser/render suite passed (`/tmp/rift-ios-format-appearance.log`). ImageRenderer omitted UIKit-backed scrolling content, so its blank code area was not accepted as application evidence. A follow-up test hosts the exact NativeMarkdownText view in a UIWindow and captures drawHierarchy. That test passed; both exported appearances were visually inspected with code text, bold text and inline code visible. Evidence: `/tmp/rift-ios-final-derived/Logs/Test/Test-RIFT-2026.09.15_15-24-00-+0300.xcresult`; attachments `/tmp/rift-native-format-hosted/`. This is component rendering in the simulator, not a live conversation or gesture test.

## Full-access polling overhead

New native sends explicitly use approvalMode full, but begin() still polled `/api/console/approvals` every two seconds until completion. begin() now cancels any previous poll, clears stale approval rows, and skips this loop for an explicitly full-access send. Resume bodies have unknown historical policy and retain polling for older review-mode tasks. This removes redundant requests from new Build, Studio and Hack sends; no provider-token or dollar savings are claimed. Compilation verification is pending while the full commit gate finishes, to avoid competing local test/build workloads.

## Composer readiness and Hack model selection

The full native suite passed after removal of full-access approval polling (40 tests). A further UI audit found that Send looked enabled even when send() would silently return: no catalog model, empty content, account loading or upload in progress. A shared canSend property now controls admission and the signed-in Send button. Signed-out users can still open sign-in; running tasks retain Stop. Unknown/stale model IDs are not dispatched. Readiness tests preserve the unsent draft.

The Hack selectedModel setter previously ignored changes and its getter always returned the first catalog entry. Hack now has independent selected model state, with first-entry fallback only before a choice is made. A regression switches Hack → Build → Studio → Hack and verifies each selection remains independent. Final native suite: `/tmp/rift-ios-model-selection-final.log`; xcresult `Test-RIFT-2026.09.15_15-46-28-+0300.xcresult`. These tests do not substitute for an authenticated end-to-end send with every model.

### Final workspace navigation and mobile Stop validation

- Current native `WorkbenchNavigationTests` passed: three rounds of Studio/Hack/Build navigation and Hack task-template insertion. 1 test, 81.905 seconds; `/tmp/rift-ios-workspace-final-ui.log`, xcresult `Test-RIFT-2026.09.15_15-48-29-+0300.xcresult`. No paid task submitted by this test.
- Investigated whether Studio needed Hack exact-execution cancellation. The admission in `lib/api/chat-handler.ts` is guarded by `hackWorkbenchOnly`; that hypothesis was not confirmed and the cancellation mechanism was not replaced.
- Mobile cancellation now separates malformed requests (400), unauthenticated requests (401), ownership denial (403), and unavailable cancellation (503). Responses are private/no-store; only a successful authenticated mutation confirms cancellation.
- Regression test reproduced five failures before the fix. All five mobile API suites now pass: 37 tests. These are mocked API contract tests, not proof of live provider interruption or long-task recovery.

### Question cards, provider logos and Studio gallery

- Bare dedicated question JSON and streaming question-fence labels now stay out of code rendering. Three regression cases reproduced five failing assertions before the fix.
- Grok now uses the Grok Mono source from installed @lobehub/icons, rather than the xAI mark. Kimi has light/dark artwork variants preserving its colored detail; Z.ai keeps its original color. Existing provider asset coverage tests pass.
- Reasoning is a separate composer menu. Studio model choices have Image/Video segments. Recent rows retain 44pt targets with reduced spacing and single-line labels.
- Sidebar heading is the RIFT mark only. New-chat navigation uses the existing expansion, Recursive Intelligence for Technology.
- Studio includes six equal-size image cards, a native detail sheet and Use template action that prepares a draft without submitting it. Gallery artwork is local showcase directional imagery, not generated task results.
- Activity opens a native medium/large sheet. HTTPS URL tool inputs show the actual host and its favicon, falling back to a globe; unknown sites are not invented.
- Final run before empty-gallery scroll-anchor adjustment passed 45 unit tests plus the Studio template UI test (25.599s), `/tmp/rift-ios-mobile-polish-final.log`, `Test-RIFT-2026.09.15_16-20-03-+0300.xcresult`. Screenshots exported to `/tmp/rift-mobile-final-attachments` and inspected. The screenshots exposed the empty gallery retaining bottom anchoring; it was changed to top anchoring for empty conversations.
- Not yet proven: live question submission round trip for every provider, live favicon loading across all tool formats, exact Grok motion parity, physical-device UI acceptance.
- Empty-gallery top-anchor verification passed, `/tmp/rift-ios-studio-anchor-final.log`, `Test-RIFT-2026.09.15_16-22-21-+0300.xcresult`. Inspected `/tmp/rift-studio-gallery-final.png`: header and first card row now start below navigation. Template detail and draft action still pass.
