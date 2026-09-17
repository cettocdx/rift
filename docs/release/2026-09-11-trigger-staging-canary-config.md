# Isolated Trigger staging canary configuration

Prepared offline from `bb22b20`. No Trigger dry run, deployment, provisioning,
environment change, or live task was performed. This configuration is preparation;
it is not hosted canary acceptance or a latency result.

## Configuration and launcher

`trigger.shared.ts` provides the ordinary and canary configs with the same Node 22
runtime, logging level, one-hour maximum duration, retry defaults, external
packages, native package installation, and pinned Playwright Chromium extension.
The ordinary `trigger.config.ts` retains its existing development `.env.local`
load, console logging choice, task directory, project selection, and optional MCP
keyring synchronization. The shared factory loads no environment files and adds
no secret-sync extension itself.

`trigger.canary.config.ts` uses the literal audited project reference
`proj_tzdasuzvmzpcjmlcafvs` and discovers `trigger-canary/agent-long.ts`, which
re-exports the existing agent. It omits secret synchronization and requires the
staging launch marker plus `NODE_ENV=production`. Use the launcher rather than
manually setting that marker; the marker is an accidental-use guard, not an
authorization boundary.

`scripts/trigger-staging-canary.cjs` creates the CLI child with an allowlist of
home/path/temp/locale/terminal variables. Application credentials, Trigger
overrides, Node injection options, and proxy variables are not inherited by that
child. The user's existing CLI login can still be read through HOME. The launcher
fixes the project, `--env staging`, `--env-file /dev/null`, `--skip-sync-env-vars`,
`--skip-update-check`, and `--skip-promotion`; arbitrary argument overrides are
rejected. It defaults to `--dry-run`. The explicit `--deploy` option removes only
that final flag. This Unix-oriented launcher uses `/dev/null`.

Neither path copies application secrets from the checkout. Trigger still fetches
the selected staging environment's remote variables, so their isolation must be
verified separately. Do not edit the ordinary development worker or preview API
to obtain staging measurements.

## Offline evidence and remaining discovery gate

Run the offline checks from the isolated checkout:

```sh
node --test scripts/__tests__/trigger-canary-config.test.cjs
node scripts/verify-trigger-canary-graph.cjs
```

Five checks passed: ordinary-config behavior and build requirements, canary
exclusion of dotenv/sync, fixed launcher flags and environment filtering,
transitive schedule rejection, and the installed Trigger 4.5.4 config loader
against disposable `.env`/`.env.local` sentinel fixtures. The config-loader check
calls only local configuration resolution, not the deploy command or login/API.

The offline esbuild repository graph contains 206 modules with zero warnings.
Its only `trigger/` modules are `agent-long.ts`, `stream-ids.ts`, and `streams.ts`;
the recognized Trigger registration is exactly `task({ id: "agent-long" })`.
A deliberately injected transitive `keep-warm` import fails the graph gate.
The checker traverses literal static/dynamic local imports without evaluating
application code and reports its external imports.

**This is not a complete runtime/distribution import-graph proof.** The check
leaves 35 external imports (including Node built-ins) outside the bundle and
recognizes named/namespace SDK `task`, `schemaTask`, and `schedules.task` calls.
Computed imports, alternate registration APIs, package-side registrations,
Trigger discovery behavior, and deploy extension output still require review.
Directory selection alone is not proof of task-only deployment.

After isolated bindings and manifest review, the launcher without arguments performs
the real Trigger dry run:

```sh
node scripts/trigger-staging-canary.cjs
```

That command contacts Trigger and builds; it is **not** an offline check and was
not run here. Inspect its generated `build.json`, entry files, full dependency
output, and a successful worker-indexing result: the only registered task must
be `agent-long`, with no schedules or additional tasks. A successful dry-run exit
alone is insufficient. In installed CLI 4.5.4, `buildWorker` invokes local skill
indexing but catches its failure; `build.json` is a build manifest, not proof of
the final registered task inventory. Capture a successful exact-bundle worker
manifest through the installed `indexWorkerManifest` interface or an equivalently
reviewed discovery procedure before treating task isolation as verified. That
indexing may execute module initialization with staging bindings and is separate
follow-up work, not part of these offline checks.

Only then consider
`node scripts/trigger-staging-canary.cjs --deploy`. Keep promotion disabled.
Verify the deployed task inventory and empty staging schedule inventory before
sending any request; never deploy the ordinary whole-directory config instead.

## Binding and live acceptance gate

The read-only inventory found staging without application bindings. Current
production/preview bindings do not provide isolation: the existing Convex and
Redis data paths are shared. This patch creates no isolated backend, Redis store,
provider/sandbox credentials, or ordinary authenticated QA identity.

Before provisioning or running, review distinct nonproduction Convex service and
API bindings, a distinct Redis store with unambiguous fallback pairs,
and a dedicated real QA account. Confirm the canary API and worker agree on those
bindings, including each request's Convex destination. Review provider, E2B, MCP
keyring and relay requirements for the intended scenario. Do not transplant an
existing user's token onto a new issuer or silently reuse preview credentials.

The separate canary API must use the staging Trigger key and lock to the exact
reviewed staging worker version. Confirm the admitted run's environment/version,
then gather a bounded matched sample through the ordinary authenticated API.
No hosted dispatch-latency improvement or production readiness is established
by these offline configuration checks.
