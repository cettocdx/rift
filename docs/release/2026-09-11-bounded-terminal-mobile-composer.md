# Bounded native output and mobile composer acceptance

Source: `/Users/cetto/RIFT-Release`, release-candidate branch. This batch follows
the installed evidence in `2026-09-11-durable-native-terminals.md`.

## Native transport

The earlier 64 KiB frontend batching limited each xterm write but did not limit
the total pending output. The new protocol retains a single 512 KiB native replay
window and sends only tiny Ready notifications through the Tauri Channel. The
renderer claims up to 64 KiB through an invoke and acknowledges it only after
xterm's render callback. Large payloads therefore do not enter Tauri's Channel
fetch cache, which can retain abandoned payloads across renderer reloads.

Credit waits release the manager lock. Owner epoch, native-issued session
incarnation, attachment and exact cursor checks protect against stale operations.
Detach/revoke/close release waiting work. Detached output intentionally has bounded,
potentially truncated replay; it is not an unlimited archive. Exit follows output
drain. Old/new protocol combinations produce explicit reload/update errors.

A real macOS blocked-input regression showed that killing the child alone did not
release a blocked master write within two seconds. Durable Unix descriptors now
use nonblocking I/O and cancellation-aware partial writes. Input has one active
and one queued request, each at most 64 KiB. Legacy PTY behavior is unchanged.
Idle reads currently retry at 5 ms; idle CPU/wakeups with several terminals remain
an efficiency follow-up.

Agent validation: 62 Rust tests, including a byte-for-byte 2.5 MB burst across
attachment replacement, stalled output, blocked input/revoke, UTF-8/EOF boundaries,
PID/environment retention and protocol mismatch. The previous output transport
reproduced 513 queued messages in the stalled-consumer regression; the new path
permits one tiny Ready notification. Focused service/drain/lifecycle tests: 28
passed. TypeScript and affected-file ESLint passed. Independent code review found
no concrete blocker for the macOS build/live gate.

## Mobile composer

The authenticated installed app at 390 × 844 exposed a send button falling to a
new row on the left and an unnecessarily truncated model name. Mobile composer
layout now deliberately places model/effort on a full-width top row and keeps
attachment/mode/permissions with a right-aligned send control below. Desktop
retains its single row. The redundant 74 px model-name cap was removed.

Actual production components and CSS were exercised in an isolated fixture:
14 cases passed across Chromium/WebKit, 360/390/430 px, coarse/fine pointers,
and desktop. Assertions cover viewport/hit testing, 44 px primary touch targets,
model readability, row alignment, menu bounds and draft preservation. Old CSS
reproduced 48 px send-row displacement; restoring the old label cap separately
failed the text-fit assertion. Existing fixture cases: 8 passed. Root's focused
composer Jest validation: 48 passed.

These fixture tests stub account/service context. They are not evidence that the
complete authenticated mobile acceptance suite or physical-device keyboard tests
have passed.

## Authenticated manual mobile inspection

Using the real signed-in in-app browser at 390 × 844, inspected Build, Agents,
Plugins, Runs (100 existing records), Tasks (one existing task and its Create
dialog), Artifacts (empty state), Studio (including model menu and unsent draft),
and Hack Workbench (empty session and task drawer). Navigation and form dismissal
worked. No model task, assessment, connection/reconnection, or task creation was
submitted. These are viewport-only Chromium observations, not coarse-pointer or
physical-device verification. Plugin category overflow is an intentional inner
horizontal scroller; the document remained 390 px wide. Installed-plugin identity
and More controls need separate coarse-pointer measurement. Populated Agents and
Artifacts were unavailable in this current account view and are not covered.

## Pending release gates

Production web/native rebuild, installation and live v2 shell acceptance are
recorded below when completed. No Cursor/Claude performance parity, production
worker promotion, Apple notarization or whole-product release readiness is claimed.

## Installed v2 acceptance

Production web and native builds succeeded. The app in Applications and build
executable match SHA-256
`a6fe6f38a7b13b4a48c64b347965b2ab757dccdc2468d04844e7bb3ece1eab6f`.
Code-signature verification passed (ad-hoc, not notarized). The restarted web
service returned HTTP 200. The installed app reached the signed-in Build screen.

- Native parent PID 79985 opened Shell PID 80075 in `/Users/cetto` without a
  workspace selection. `seq 1 120000` reached its final row and ready prompt;
  this observation did not measure precise render time.
- An eight-iteration command emitted timestamps two seconds apart. Cmd+R after
  the fifth observed timestamp preserved all eight (`1789085211` through
  `1789085225`), the selected Shell panel, Connected state and PID 80075.
- `printenv RIFT_V2_PROBE` returned the previously set `retained` value after
  reload. Bounded-history truncation was explicitly disclosed.
- `exit 7` rendered Exited 7. Cmd+R retained that completed state, without respawn.
  OS inspection confirmed PID 80075 gone. Explicit Restart created PID 80502.

Root's full Jest run passed: 619 suites, 5,482 tests, one existing skipped test,
24 snapshots. Final type generation and TypeScript also passed. Build output:
`/tmp/rift-bounded-terminal-web-build.log` and
`/tmp/rift-bounded-terminal-native-build.log`; full Jest output:
`/tmp/rift-bounded-terminal-full-jest.log`.

These short installed tests supplement deterministic transport tests. They do
not establish arbitrary-duration process durability, physical-device behavior,
or a comparative performance result.

## Plugin targets and final mobile build

Actual marketplace components in the browser fixture reproduced 19.5 px installed
name buttons and 32 px More buttons on coarse pointers. The existing logo/name/
description area is now one identity button, and More is 44 × 44 px on coarse
pointers. Connect/Reconnect already had 44 px mobile touch height. Fine-pointer
sizes remain unchanged. Measured 390 px card heights remained 68/75/75 px.

Fourteen plugin cases executed and passed, none skipped, across the same browser,
viewport and pointer matrix; 24 marketplace unit tests passed. Root detected that
a subsequent Playwright `--list` command had overwritten the initial report with
14 skipped discoveries. The agent reran the complete matrix and verified executed
results with geometry attachments. Preserved executed report:
`/tmp/rift-plugins-complete-2026-09-11T00-08-38.868Z.json`.

The final production web build including plugin changes succeeded and its service
was restarted. In the real authenticated 390 px browser, the rebuilt composer
measured model/effort at y=755 and attachment/send at y=791, with send x=337 and
right edge 369. Document width stayed 390; the model name was readable. This
browser has a fine pointer (32 px controls); 44 px coarse-pointer acceptance is
the separate fixture evidence above. The native executable was unchanged.
