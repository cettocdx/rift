# Durable native terminals — live acceptance evidence

Source: `/Users/cetto/RIFT-Release`, release-candidate branch. Installed preview:
`/Applications/RIFT UI Preview.app`, bundle `app.riftsys.ui-preview`.

## Reproduced failure and change

The old terminal effect killed the native PTY on renderer unmount. Its reader also
stopped when the original IPC subscriber disappeared. Merely keeping the React
panel hidden was insufficient for reload durability.

Native profile terminals now retain processes and bounded replay independently
of the renderer. A stable client tab identity reattaches to the same process;
attachment IDs prevent stale cleanup from detaching a newer subscriber. Explicit
Close/Restart still terminates the intended process. Original folder grants are
latched rather than replaced by a refreshed picker value.

Account generations and capture-at-entry checks reject delayed operations from
an old account. Resolved sign-out/account changes revoke process ownership and
grants; temporary authentication hydration does not. Grant refresh responses are
also checked against the current revision. The retained child handle, foreground
job termination and bounded shutdown wait cover HUP-resistant processes and avoid
signalling a recycled PID when closing an already-exited terminal.

Replay is capped at 512 KiB per terminal, with eight retained sessions. Trimming
is reported explicitly on reattachment. Closed-tab revocations are capped at
4,096 per native account epoch; at saturation new sessions require restarting
Desktop rather than discarding revocations. These are documented limits, not
unbounded persistence. Quitting the native app ends its processes.

## Verified before the next output-flow refinement

- 54 native tests passed, including real PTY PID/variable preservation,
  detach/reattach, completed-session replay, restart isolation, owner revocation,
  HUP-resistant child termination and stale-operation rejection.
- Full Jest: 617 suites, 5,457 passed, one existing skipped, 24 snapshots.
- TypeScript passed. Web release and native app builds succeeded.
- Installed executable matches the build SHA-256:
  `fa32ff273f9070f8478901dcd2a7fda02e4d659fae8094dd9510c5f2e4ff1803`.
  Local code-signature verification passed; this is an ad-hoc signature, not
  Apple notarization or a clean-Mac distribution test.
- Actual desktop Shell opens in `/Users/cetto` without selecting a workspace.
- Shell PID `58928`, parent `58768`, and variable `RIFT_RELOAD_PROBE=durable`
  survived Cmd+R. Previously printed history remained visible.
- A bounded command emitted eight timestamps at two-second intervals.
  Cmd+R occurred after the fourth timestamp was observed. Reattachment showed
  all eight timestamps exactly once (`1789083068` through `1789083082`) and a
  ready prompt. No second process or repeated command was started.

## Live defects found and retested

Reload originally hid the panel and reset its selected view to RIFT console.
The account-scoped presentation hook now retains open/closed state and the
selected view for same-route reload. Live Cmd+R restored the open Shell without
additional clicks and retained process 59915. Switching accounts and hydration
races are covered by focused integration tests, not a live account-switch test.

A burst of `seq 1 120000` exposed substantial renderer lag: the native command
had already ended (no child of the shell remained), while visible output was
still around lines 8,183, then 14,391 and later 59,515. The native history cap does
not bound the renderer's per-chunk Promise queue. The native path now coalesces
ordered UTF-8 bytes into at most 64 KiB per xterm write, with one render callback
in flight, cancellation and exit-after-drain ordering.

Two live 120,000-line bursts reached the final line and ready shell prompt by the
first post-submit observations at 10,347 ms and 7,117 ms respectively. These are
**observation upper bounds**, including automation latency, not measured render
completion times or a statistically established speedup. The previous visible
backlog did not recur. Lossless byte order is checked separately by helper tests.

`exit 7` changed the UI to Exited 7; Cmd+R retained the final output and Exited 7
without spawning a replacement. OS process inspection confirmed PID 59915 ended.
Replay trimming was explicitly disclosed after the large output. Explicit Restart
then opened process 62186 with a fresh terminal.

### Remaining flow-control limit

Historical limit at this batch's revision: the native Shell/profile transport
was subsequently replaced by bounded v2 flow control. See
[bounded terminal evidence](2026-09-11-bounded-terminal-mobile-composer.md)
and [reader readiness refinement](2026-09-11-terminal-readiness-mobile-switch.md).
The legacy desktop execution bridge and server SSE paths are separate transports
and are not covered by that native-profile result.

Each write is bounded, but the total pending frontend queue and Tauri channel
backlog are not. Indefinite output can still outpace rendering. A reviewed next
step is attachment-scoped pull-after-render with cumulative acknowledged cursors,
a 512 KiB native credit window and condition-variable wakeup on detach/revoke/
close. This is **not implemented in this batch**; do not interpret batching as
bounded total memory. Detached history remains intentionally truncated with notice.

## Additional verification

- Root reran 31 focused output/presentation tests and TypeScript successfully.
- 16 mobile guard/focus harness tests passed in Chromium and WebKit.
- Actual rebuilt public mobile release: 12 login/signup viewport, hit-target and
  keyboard checks passed at widths 360, 390 and 430 in Chromium/WebKit.
- Desktop bootstrap/layout: ten tests passed; these simulate runtime dependencies.
- Sustained mixed renderer replay: 1,200 updates, 200 history rows, 19 interactions
  and two disclosure toggles over approximately 32 seconds per engine. Chromium
  frame p95 16.7 ms, max 16.8 ms, event p95 16 ms; WebKit frame p95 20 ms, max 26 ms.
  Neither run had frames over 50 ms. Draft/link/final text were retained. WebKit
  does not expose event timing/long-task/heap metrics here; null is not zero.
  This is isolated component evidence, not a whole-app or real-model benchmark.

These results do not establish long agent-task/network resilience, indefinite
terminal output capacity, physical-device behavior or parity with competitors.

## Final source and installed web validation

Implementation commit: `c17770a`. Its commit hooks passed ESLint/formatting,
`next typegen && tsc --noEmit`, all 619 Jest suites (5,470 passed, one existing
skipped test), and 24 snapshots. Rust was rerun: 54 passed. Console checks were
also rerun: 56 CLI tests and ten OpenTUI tests (46 assertions) passed.

A final production web build succeeded and the Preview LaunchAgent restarted
successfully (HTTP 200). The native executable was unchanged from the verified
SHA above; code-signature verification passed again. Source was clean following
the implementation commit.

The compact shell toolbar now exposes Close active terminal, rather than making
closure depend on a hard-to-discover tab keyboard action. In the installed app,
two shell processes were running (62186 and 62243). Closing selected Terminal 2
removed process 62243 and restored Terminal 1; OS process inspection confirmed
62186 remained and the UI showed Connected. The RIFT console has no added shell
close action.

An additional route-switch probe was inconclusive because desktop automation
reported that the user changed the application before the navigation action. Its
command finished normally; it is not counted as background-navigation evidence.
The earlier successful Cmd+R probe remains the bounded durability evidence.
