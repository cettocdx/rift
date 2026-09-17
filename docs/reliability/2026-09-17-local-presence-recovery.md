# Local admission during relay reconnection

## Evidence and fix

The installed managed local runner is alive and configured for the same `elated-poodle-998` backend as the active app. Its logs include successful local commands as well as a previous transient DNS failure. No managed runner restart or main-network interruption was performed.

`assertLocalSandboxOnline` previously rejected immediately on an empty first presence response or any transient client/subscription error. This turned normal reconnect races into a false offline admission failure, even though the existing probe already allowed a five-second deadline.

The probe now repeats the read for the exact selected connection, at most every 500ms within the original five-second deadline. Centrifuge retains control of transport reconnection. A terminal disconnect or unsubscribe still rejects immediately. Timers and listeners are removed on completion, and late responses cannot reopen a settled check. No command is used as a connectivity probe; another runner or cloud workspace is never substituted.

## Validation

Three new regression cases failed before the change: delayed selected-runner presence, transient presence request failure, and transient initial transport failure. Regression coverage also checks a terminal unauthorized disconnect, a permanently absent runner, an unresponsive relay, an unrelated runner, and a presence response arriving after the deadline.

A live test registered one separate QA connection through the ordinary `localSandbox:connect` API using the configured runner credential. It advertised `commands: false, pty: false`, subscribed to its own channel only, and did not execute any command. The old production probe rejected in **54ms** while the connection was still starting. The current probe accepted the same connection in **1519ms**, after a deliberate **1200ms** delay before joining the relay. The QA connection was then disconnected through the ordinary API and cleanup returned success.

Receipts: `/tmp/rift-local-presence-red.log`, `/tmp/rift-local-presence-green.log`, `/tmp/rift-local-presence-live-0917.json`, `/tmp/rift-local-presence-lint.log`, `/tmp/rift-local-presence-typecheck.log`. Baseline/current compiled probes are in `/tmp/rift-local-presence-0917/`.

## Limits

This fixes an admission race, not an actually offline computer, revoked credentials or every historical Local failure. It is not a long-task execution test. Hosted staging version 20260917.6 and the older release on 3080 predate this source change.

## Packaged follow-up

The full source Jest suite subsequently passed: 821 suites, 8,450 passing tests, one skipped and zero failures. `pnpm run build:ui-release-preview` completed with exit 0, producing `.next-ui-release-1789623568465-4f3a9640`. This release is running separately on port 3081 and `/login` returns HTTP 200. Build receipt: `/tmp/rift-local-presence-release-0917.log`. The installed desktop app and main worker were not restarted or promoted.
