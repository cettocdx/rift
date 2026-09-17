# Local relay origin binding

Baseline: `df00e29`. This change binds local relay operations to their originating configuration and database authority. Worker process reuse remains **off**; this is prerequisite isolation work, with no measured startup improvement claimed.

## Source boundary

- `lib/ai/sandbox-context.ts` captures only the relay WebSocket URL and signing secret alongside the existing immutable sandbox context. Existing worker scope capture therefore snapshots these values at run entry.
- `lib/centrifugo/relay-origin.ts` copies and freezes that configuration together with the original Convex client and explicit service key. Missing authority remains missing; it cannot borrow a later run's environment.
- `lib/ai/tools/index.ts` captures the relay origin outside model rebuilds and passes it to the hybrid manager, desktop computer/workspace tools, and desktop loopback browsing.
- `lib/ai/tools/utils/hybrid-sandbox-manager.ts` and `lib/desktop/local-access-relay.ts` retain the original client/key across ownership-query awaits and bind transport creation and signing to the same origin. Missing required configuration fails before a query or socket connection.
- `lib/ai/tools/utils/centrifugo-sandbox.ts` copies the incoming mutable configuration. Ordinary commands and PTY token refresh now use its captured signer. `lib/ai/tools/utils/local-sandbox-presence.ts` also signs with the supplied origin.
- `lib/centrifugo/jwt.ts` preserves the existing subject, HS256 algorithm, JWT type, and requested expiry. Owner, capability, desktop grants, presence, abort, and preference revision checks remain in place.

No captured authority is added to model descriptions, tool results, task payloads, or telemetry.

## Regression evidence

`lib/centrifugo/__tests__/relay-origin.test.ts` contains 18 origin regressions covering A-to-B environment changes, copied configuration mutation, missing URL/key/client/explicit service key, deferred ownership queries, ordinary commands, actual PTY refresh callbacks, and all three desktop tool factory rebuild paths. Signatures verify with A and reject B; public results are checked against synthetic credential fixtures.

The test executes the installed **jose** implementation for signing and verification. It bundles that implementation in memory using the installed Trigger CLI's esbuild dependency because the repository otherwise maps jose to a Jest mock. Convex network transport and Centrifuge sockets/events are mocked. RIFT scope selection, manager/helper/tool code, and the PTY refresh closure execute normally. This is not live database, relay, or desktop grant validation; no network or paid provider calls were made.

The preimplementation run recorded eight meaningful origin failures in `/tmp/rift-relay-origin-red.log`; a ninth failure was a test API-shape mistake subsequently corrected. Earlier jose test-loader failures are not counted as origin evidence.

- Focused integration checks: **141 tests in 12 suites passed**, normal exit 0 (`/tmp/rift-relay-origin-focused.log`).
- Final standalone origin checks: **18 tests passed**, normal exit 0, with no open-handle warning (`/tmp/rift-relay-origin-final.log`). Test cleanup drains the existing PTY shutdown grace timer with fake time; production PTY behavior is unchanged.
- Full TypeScript check and scoped source lint: normal exit 0 (`/tmp/rift-relay-origin-tsc.log`, `/tmp/rift-relay-origin-lint.log`). After the final test-only loader/cleanup refinements, scoped test lint also exited 0 (`/tmp/rift-relay-origin-test-lint.log`). No process was forcibly terminated.

## Remaining boundary

Project/chat namespace signing in `lib/projects/project-runtime.ts` still reads its effective signing secret after asynchronous work. Capturing that origin with the existing explicit/project/service-key precedence, missing-value semantics, and unchanged HMAC bytes requires a separate regression-backed change. Namespace behavior was deliberately excluded here. This patch alone does not certify worker process reuse as safe.
