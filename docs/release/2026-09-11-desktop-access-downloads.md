# Desktop access, downloads and responsive follow-up

Source: `/Users/cetto/RIFT-Release`, branch `codex/release-candidate-2026-09-11`.
The running Preview is installed at `/Applications/RIFT UI Preview.app`.
The web Preview on port 3020 now reads the release build from this checkout.
The installed native bundle was rebuilt from this checkout and its ad-hoc
signature verified. It is not Apple-signed or notarized for public distribution.

## Implemented behavior

- A signed-in native app advertises its desktop connection even without file or
  computer grants. Presence does not confer permission to execute operations.
  Native grants continue to gate each operation; sign-out revokes access.
- Relevant permission/connection failures present computer access in the chat.
  Historical results, healthy probes, unsupported vision models and uncertain
  input outcomes do not invite an unrelated continuation. macOS privacy settings
  can be opened through two explicitly allowlisted native commands.
- Images, attachments, artifacts and ZIP exports use the same binary save path.
  Native downloads preserve bytes, create files exclusively, and use numbered
  names instead of overwriting existing files. The independent download budget
  is 64 MiB; the workspace file policy is unchanged.
- A failed or missing selected ZIP entry aborts the export, identifies the file
  and keeps selection for retry. HTTP error bodies are not archived as files.
- Mobile composer autofocus waits for the breakpoint to resolve. Desktop focus
  is deferred once and does not steal focus from an already focused control.

## Confirmed relay failure and fix

The running Centrifugo 5.4.9 relay used the default 65,536-byte inbound WebSocket
limit. A synthetic 200,000-byte publication closed the connection with code 3,
`message size limit exceeded`. RIFT native screenshots allow a 500 KiB JPEG,
which becomes 682,668 base64 bytes. The bridge itself bounds serialized results
at 768 KiB, so the relay's smaller default was incompatible with the product.

`docker/centrifugo/config.json` now sets `websocket_message_size_limit` to
1,048,576. The same bounded setting was applied to the running Preview relay's
private configuration; the private backup and credentials remain outside Git.
The native relay configuration passed `centrifugo checkconfig` and was restarted
after the current test task ended.

A second defect kept the bridge's registration ID after a terminal size-limit
disconnect. The hook interpreted that retained ID as an active reconnect loop
and never recovered. `reconnectTransport()` now retries only Centrifuge code 3,
only while its client is disconnected, through the existing online/focus/30-second
recovery path. It retains the same registration, subscription and mutation
deduplication records. Unauthorized, kicked, stopped and already-reconnecting
clients remain untouched. A successful subscription is still required for readiness.

The checked-in `scripts/verify-desktop-relay-frames.cjs` verifies the actual relay:

```sh
node --env-file=.env.local scripts/verify-desktop-relay-frames.cjs
```

Both runtime assertions passed: the maximum native screenshot-sized synthetic
payload returned unchanged, and a frame exceeding 1 MiB was rejected. This does
not generate a real screenshot, operate the computer or inspect account data.

## Validation

| Check                                   | Result                                                              |
| --------------------------------------- | ------------------------------------------------------------------- |
| Full Jest                               | 614 suites; 5,410 passed, 1 skipped; 24 snapshots passed            |
| TypeScript                              | `pnpm typecheck` passed                                             |
| Application lint                        | `pnpm lint` passed                                                  |
| Production web build                    | `pnpm build:ui-release-preview` passed; 3020 HTTP 200 after restart |
| Native Cargo                            | 41 passed                                                           |
| Desktop/source configuration Node tests | 16 passed                                                           |
| Console build and Node tests            | 56 passed                                                           |
| OpenTUI                                 | 10 passed                                                           |
| Maximum relay frame round trip          | Passed, 682,668 base64 bytes                                        |
| Oversized relay frame rejection         | Passed                                                              |

Raw local evidence is in `/tmp/rift-sept11-*`. Runtime secrets, generated outputs
and raw native diagnostics were not added to source control.

## Streaming interaction measurements

The existing production-component replay used 200 history rows, 600 streamed
updates, continuous typing, tool expansion, hover/keyboard actions and repeated
panel toggles. Each browser ran independently at a 1200×800 viewport.

| Engine                 | Duration | Frame p95 | Maximum | Frames >50 ms | Input/final output |
| ---------------------- | -------: | --------: | ------: | ------------: | ------------------ |
| Chromium 140.0.7339.16 | 16.147 s |   16.8 ms | 16.8 ms |             0 | Passed             |
| WebKit 26.0            | 16.637 s |     19 ms |   67 ms |             3 | Passed             |

Chromium reported zero long tasks. WebKit does not expose those metrics in this
run, so absence of reported long tasks is not a zero result. These are isolated
component replays, not live-model latency, physical iPhone tests, the complete
Tauri runtime, or a controlled Cursor/Claude comparison. WebKit's slow frames
remain a performance investigation item.

## Open acceptance items

- Live desktop status previously returned enabled computer, Screen Recording and
  Accessibility permissions. Real screenshot requests then timed out. The first
  post-config attempt also timed out because the old bridge had already stopped;
  it did not send Escape. The terminal-disconnect recovery fix was added and
  deployed after that attempt.
- A subsequent native consent attempt remained pending without a dialog visible
  to the available native UI automation. The process stack showed
  `MessageDialogBuilder::blocking_show` waiting. No fresh real screenshot → Escape
  → screenshot success is claimed. Diagnose that native consent presentation and
  complete this limited live test before closing computer-control acceptance.
- Binary byte integrity, collision handling and component download error paths
  passed tests. Actual native image-download UI followed by disk-hash comparison
  is still required.
- The existing scroll-layout script cannot run against production `/lab/scroll`:
  `DevLabGate` deliberately blocks lab routes in production. That attempt timed
  out waiting for the fixture; it is not a product scroll-regression result.
  Run it against an isolated development fixture without exposing lab routes in
  the production app.
- Authenticated mobile Playwright execution, physical Safari keyboard/rotation,
  all-route geometry and complete desktop product acceptance remain open. See
  `docs/audits/2026-09-11/mobile-responsive-verification.md`.
- Composio and competitor landing research is recorded in
  `docs/research/2026-09-11-composio-rift-landing-brief.md`. The research is complete
  for this pass; the requested landing replacement has not been implemented here.
- Production worker validation, tenant isolation, backup/restore, billing retry
  correctness and Apple distribution gates from the release plan remain open.
