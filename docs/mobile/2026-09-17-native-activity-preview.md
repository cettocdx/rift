# Native iOS Activity, Preview and Hack scope

## Changes

- Native toolbar now exposes Activity and Preview directly. A shared native sheet keeps the composer draft and running stream outside the panel lifecycle.
- Live Build preview URLs are read only from successful `expose_preview` tool receipts, including restored conversation history. Preview pages use an ephemeral WKWebView without RIFT session cookies or a native bridge. Loading, retry, HTTP failure, reload and share states are available; unavailable servers are not represented as working previews.
- Activity preserves terminal and structured tool results, including public-search evidence. String `Error:` receipts are no longer shown as completed calls.
- Studio consumes the existing `data-media-progress` events for preparing, generating and saving image/video outputs. Late progress cannot restart a completed tool.
- Reasoning-only turns survive the next send instead of disappearing when there were no tool calls.
- The selected Hack target is included in actual message parts. The shared chat handler does not consume the former standalone `scope` field. Unresolved preset `{target}` placeholders use the selected target; no authorization is inferred from merely selecting a target.

## Verification

- Before fixes: targeted native tests reproduced media-progress loss, structured-output loss and reasoning-only history loss (12 tests, five failed assertions), `/tmp/rift-ios-mobile-panels-red.log`.
- After fixes: 55 native tests pass, zero failures. One new XCUITest passes: type a draft, open Activity, switch to Preview, close, verify the draft, reopen Preview and return to the chat. `/tmp/rift-ios-mobile-panels-acceptance.log`.
- Screenshot inspected: `/tmp/rift-ios-panels-screens/D7EED1A5-D43F-4274-B103-F48FB32E2F4F.png`. This is the native empty preview state, not evidence of a live generated project.
- Release archive build 0.1.0 (3): `/tmp/RIFT-TestFlight-0917-build3.xcarchive`. Production origin, four iPad orientations, encryption declaration and strict signature verified.

## Still requires live acceptance

- Authenticated native preview of an actual running project, live film/video generation and the user's failing OSINT task. The scope bug is confirmed, but not established as the only cause of that particular task failing.
- Physical iPhone installation and long background/reconnect behavior.
- This patch does not claim zero backend/tool/provider failures and does not restart the main worker.
