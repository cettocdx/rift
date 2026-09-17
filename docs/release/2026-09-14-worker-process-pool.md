# Bounded worker process reuse

## Change

The ordinary Trigger config now enables the SDK's `processKeepAlive` with
`devMaxPoolSize: 2` and `maxExecutionsPerProcess: 10`. Set
`RIFT_WORKER_PROCESS_REUSE=false` and reload the supervisor to roll back. The
separate staging-canary config remains unchanged. No provider, model, reasoning
setting, authorization, billing reservation or execution fence was changed.

This reuses initialized processes after SDK cleanup; it does not pre-create two
workers, keep every worker alive forever or eliminate provider TTFT. The installed
4.5.4 development pool retires idle processes after 30 seconds. A cold task can
still need a process. A reused process must still establish a fresh run scope.

Existing application scopes capture separate database, Redis, provider, telemetry
and sandbox clients. Remote command journals and confirmed PTY scopes are per run;
late callbacks retain their originating scope. Task finalization removes its
cancellation map entry, watcher and abort listener, and drains remote integrations.

## Verification

- New config test failed before implementation and passes afterward.
- 46 tests passed across Convex scope regression, confirmed PTY scope, cancellation
  lifecycle and API cleanup scope. Includes same-deployment distinct auth clients,
  sequential and overlapping contexts, and sealed old PTY callbacks.
- TypeScript, scoped ESLint and diff whitespace checks passed.
- Full config file: 6/7 tests passed. Existing canary static graph check rejects
  the task registration graph (factory-based agent registration); this was not
  relaxed to enable process reuse. Production deployment is not claimed.
- Worker service reloaded once after an idle check: 317 claims all released,
  zero active HTTP executions or mapped chat streams at 09:43:27 UTC.

Live mixed scenario evidence is recorded separately below. Unit coverage is not
proof of all multi-user tool combinations or production load isolation.

## Live result

Worker `20260914.15`, same model `build-codex`, medium effort, three persisted
mixed scenarios: all completed and scenario-verified, no duplicate observed events.
Evidence: `/tmp/rift-startup-pool-20260914.json` and
`/tmp/rift-pool-reuse-proof.json`.

| Scenario    | First text | Admission | Dispatch to handler | Handler to model request |
| ----------- | ---------: | --------: | ------------------: | -----------------------: |
| Greeting    |   21165 ms |  18059 ms |             2431 ms |                  1432 ms |
| Explanation |   24126 ms |   8327 ms |             2644 ms |                  5959 ms |
| Terminal    |   20236 ms |   2233 ms |             1880 ms |                  3104 ms |

Explanation and terminal report the identical module probe start
1789379156729 and ready time 1789379158313, with process age increasing from
27704 to 50765 ms. This confirms initialized process reuse across distinct chat
runs. The historical module evaluation window is not a new cost on each warm run.

The preceding no-reuse terminal sample took 17969 ms dispatch-to-handler; this
sample took 1880 ms. These are exploratory individual observations under varying
host load, not an established latency reduction percentage. Request admission and
provider latency remain substantial; pooled first text is still 20–24 seconds.
Four-second goal NOT achieved. No claim of persistent production capacity or full
multi-user live acceptance is made.
