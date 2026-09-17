# Native RIFT console acceptance — 2026-09-15

## Implemented

The desktop console can run the packaged RIFT fork of upstream Codex app-server. Its model requests pass through the RIFT authenticated Responses gateway and existing keyed credit lifecycle. The app owns the process; the UI attaches a reader and sends public protocol messages. Native state and saved thread IDs are isolated by account and writable workspace grant.

Pinned upstream: `a8964cb1bad67bc26a826fb07d1bef99c6a3f008`. Package includes the main executable, code-mode host, upstream model metadata, license, notices, and checksums; desktop staging signs both executables.

## Verified before installation

| Check                                                   | Result                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Gateway + namespace mapping                             | 44 tests passed                                                             |
| Existing keyed credit accounting                        | 39 tests passed                                                             |
| Console protocol/recovery/native client                 | 78 tests passed                                                             |
| Native service, selection, owner isolation and draft UI | 19 Jest tests passed                                                        |
| Native Rust bridge/relay/process                        | 12 tests passed                                                             |
| Full desktop suite before latest added cases            | 75 tests passed                                                             |
| Package/installer                                       | 5 Python tests passed                                                       |
| Desktop staging                                         | 1 test passed                                                               |
| Signed native package read/edit/check                   | Passed local Responses fixture                                              |
| Actual app-server file approval                         | Accept changed1→2; decline preserved1                                       |
| Actual app-server MCP                                   | Approved echo completed and returned expected result                        |
| Existing RIFT account + GPT-5.6 Sol                     | Four model attempts performed read/edit/check; all four completions settled |
| Existing RIFT account + GPT-6 Astra                     | Live Responses reply completed                                              |

Live provider test artifacts remain under `/tmp/rift-native-live-tools-result.jsonl` and `/tmp/rift-native-astra-live.sse`; they contain test output, not account credentials.

Reproducible zero-charge packaged verification: `python3 packages/desktop/scripts/verify-native-codex.py`. This verifies file approval/denial, read/edit/check, actual completed MCP output, and fresh-process thread resume with no additional model call.

## Deployment status

Native desktop build passed and its verified signed app is installed in `/Applications/RIFT UI Preview.app`. The prior app and release pointer are retained under `~/.local/share/rift-ui-preview/native-migration-backup-20260915`. Final immutable web build passed and is active on localhost:3020. Installed UI acceptance verified existing account, explicit workspace, read/approved patch, saved-thread recovery, and successful read-only verification (`RIFT_NATIVE_UI_OK`). Installed UI denial preserved value2 and the agent stopped without an alternate write. Stop produced a native interrupted turn and the panel returned Ready. The subsequent native task completed with RIFT_AFTER_STOP_OK; the installed UI subsequently displayed the marker and Ready. UI inspection remains intermittently delayed under severe host memory pressure. The 30-second command had already completed before the interruption reached the engine, so this UI check does not establish termination of a running shell child. No public production release or standalone `rift` replacement has occurred.

## Scope and limitations

- First gateway rollout supports eligible personal pro/ultra keyed-credit accounts with auto-reload disabled. Organizations and unsupported billing paths receive explicit errors.
- Native local workspaces are supported; remote execution targets need their own native exec-server integration.
- MCP confirmation-only forms support once-only approval/denial. Forms requiring values or URL elicitation fail explicitly and can be disconnected.
- Normal shutdown uses app-server EOF cleanup, followed by bounded owned-process termination. On macOS, an unseen process spawned and reparented entirely between ownership samples can escape after an abrupt parent crash. This is best-effort crash cleanup, not kernel-enforced containment.
- Model attempts are not retried automatically; reconnect restores a saved thread without resending uncertain commands.

## Implementation decisions

- Existing feature checkout retained because the running preview depends on unrelated dirty work; no automatic commits.
- Skill task briefs extracted with Python because packaged helper scripts lacked executable permissions.
- RIFT credential stays in native relay; app-server receives a route-scoped nonce.
- Executable tool events are withheld until usage settlement succeeds.
- Original model metadata is mapped to RIFT IDs, using standard Responses plus namespace adaptation to retain Codex tools.

## Final recovery regressions

Owner changes synchronously invalidate old subscriptions, pending connections, command callbacks and composer drafts. A failed approval/answer delivery is surfaced as uncertain and requires explicit disconnection before recovery. New conversation records an intentional reset so old process replay cannot resurrect prior history.

## Installed runtime findings resolved

- Genuine pinned Codex reasoning continuation can send `content:null`; schema now accepts this and omits the null provider field while preserving encrypted content. Captured request failed before and passed after; malformed variants still fail before billing.
- Idle authoritative polls no longer publish unchanged snapshots. Actual output, request changes and public summaries still publish. Two subscription-count regressions reproduced the previous churn.
- macOS sampling showed cold debug startup spending nearly all sampled time in SHA-256 package verification. Only the `sha2` dependency is optimized in the desktop dev profile; all bundle checks remain. Rebuilt/signed app resumed saved history within the observed19s bound, including app-server startup and UI polling.

## Final UI responsiveness investigation

The after-Stop task completed in74.7s (first token63.1s), as recorded in the native rollout. UI automation still intermittently times out and the panel can remain visually stale. Host swap use reached31.3GiB on an18GiB machine; even a process listing temporarily stalled. Earlier WebKit sampling also showed repeated root `:has()` descendant scanning during accessibility/style updates. A narrow shell-presence selector fix now uses reference-counted body/html attributes owned by actual shell mounts. It leaves component-local selectors and CSS declarations intact, and preserves portal inheritance and specificity. RootShellPresence/theme tests passed27/27, lint and13 TSX parse checks passed, independent review PASS. Root attributes appear at hydration; direct shell fallback remains before hydration. Replacement web build `.next-ui-release-1789472001654-695e2d2a` passed (13.3min compilation under host pressure,86s TypeScript,133 pages). Preview launchagent restarted and HTTP3020 returned200. Post-deployment shell loaded with the existing account. Folder chooser accepted the fixture workspace, saved native history returned with RIFT_NATIVE_UI_OK and RIFT_AFTER_STOP_OK, and the user subsequently submitted new messages that received native replies. Final accessibility inspection completed in3.37s; chooser actions were responsive. This is a functional acceptance observation, not a controlled performance benchmark or a guarantee that host-pressure delays are eliminated.

## Terminal command screenshot follow-up

The separate installed `~/.local/bin/rift` remains0.3.5, confirmed by offline `rift --json doctor` (`ok:true`, `harness:local-tool-loop`). The reported screenshot shows an optional missing AGENTS.local.md read followed by an active application-type question; it does not show a terminated session. No placeholder guidance file was created and no standalone replacement was made. The approved native migration is installed in RIFT UI Preview. At handoff the native panel uses the fixture workspace; select the intended project via Choose folder before real project work.
