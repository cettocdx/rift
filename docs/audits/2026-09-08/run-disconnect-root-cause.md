# Preview run interruption: September 8

## Observed failure

Chat `d43f924d-0997-4d29-a7e0-a81f377dcae9`, run `run_06g8231uojblcd9r1g1vbhi901`, started 15:44 local. Trigger confirms FAILED. Its payload selected local connection `01b3768e-86ad-4694-b320-80f6ac302c5e`; the chat row still recorded `e2b`. The worker failed the local presence probe before model usage. This was not evidence of an OpenRouter/model disconnection.

The configured relay is `ws://localhost:8000/connection/websocket` in both the local environment and development Convex. Nothing listened on port 8000. `/Applications/Docker.app` is a symlink to `/Volumes/Mac-External-Apps/Applications/Docker.app`; that volume is absent. The previous preview relay depended on that Docker installation.

## Repairs

- Installed checksum-verified official Centrifugo 5.4.9 Apple Silicon binary, matching the existing v5 configuration, on the internal disk. Reused the existing signing secret; did not rotate credentials or expand computer/file grants.
- Native relay listens only on 127.0.0.1 and is managed by the user's launchd service `app.riftsys.preview-relay`. RunAtLoad and KeepAlive recover process exits independently of Docker or an external drive. Private configuration remains under `~/.local/share/rift-ui-preview/centrifugo/`.
- Added explicit preview origins for port 3022; no wildcard origins.
- Agent admission checks the selected local runner before dispatching or saving a new turn. Worker independently checks again before using it. No silent Cloud fallback.
- Claim activation persists the execution target before assistant output. Claim release persists a bounded product-owned error description. New runs clear previous errors; stale and duplicate cleanup cannot overwrite them; user cancellation is not presented as failure.
- Reloaded conversations can render the durable failure instead of the generic interrupted-response banner.

## Verification

- 85 targeted tests passed across six suites; TypeScript check passed. Logs: `/tmp/rift-run-failure-tests-final.log`, `/tmp/rift-run-failure-types-final.log`.
- Development Convex functions deployed successfully. Production preview rebuilt as `.next-run-recovery-release` and served on port 3022; HTTP 200 verified. Build log: `/tmp/rift-run-recovery-build-final.log`.
- Relay internal `/health`: HTTP 200.
- Actual worker-signed WebSocket authentication, channel subscription, and presence query: 9 ms, previously timed out.
- Presence explicitly reports the old local runner offline. Restoring the relay does not start a command runner or grant PC control. Local execution still requires reconnecting that runner; Cloud execution does not.
- Original failed run was not replayed. No original project files or user messages were changed by the investigation.

Installation reference: https://centrifugal.dev/docs/getting-started/installation
