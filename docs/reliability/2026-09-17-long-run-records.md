# Long-running tasks must not be closed by age

## Evidence

The previously observed live run was read again and reported EXECUTING, version `20260917.4`. Its saved run record reported `running` / `verifying`, and the event inventory contained step 30 and recent tool activity. It was not treated as stalled merely because it had been running for roughly 40 minutes. No user task was interrupted.

The review found a conflicting legacy rule: `runStaleRunsReconcile` assumed a 60-minute worker ceiling plus 15 minutes of grace. `reconcileStaleRuns` then wrote `disconnected` and `ended_at` for every sufficiently old open run. The actual worker uses `maxDuration: timeout.None`. The old sweep could therefore present live work as ended.

## Fix

- Age selects reconciliation candidates only. It does not establish termination.
- A run record can be repaired from its exact persisted assistant message only when account/chat binding, timestamp and an explicit final finish reason agree.
- `checkpoint`, `tool-calls`, absent and unknown finish reasons do not close a run. Length/content-filter outcomes are recorded with warnings, not as unqualified completion.
- The public saved-message reconciliation path shares these checks. Previously it accepted a checkpoint as completion because it excluded only `tool-calls`.
- The cron advances through bounded pages even when none of the long-running entries can be closed. It does not repeatedly revisit the first page and starve later final outcomes.
- Execution claims and remote cleanup receipts are not released by this sweep.

## Verification

- Before the change: 10 failed / 4 passed in the behavioral reconciliation suite (`/tmp/rift-long-run-sweep-red.log`).
- After: 46 tests passed across run reconciliation, cron pagination, run storage and ops alerts (`/tmp/rift-long-run-sweep-regression.log`).
- Full database suite: 67 suites / 1,020 tests passed (`/tmp/rift-convex-release-suite.log`).
- Scoped ESLint and diff whitespace checks passed. Both full TypeScript checks exited zero, including the final cron test (`/tmp/rift-long-run-sweep-final-types.log`).

## Deployment boundary

Initially not pushed; the actual deployment and verification are recorded below. Existing records already marked disconnected are not blindly reopened; they require their own authoritative outcome check.

## Deployment preflight completed

The configured local client uses dev deployment `elated-poodle-998`; `convex deploy` targets production `content-robin-881`. The first noninteractive dry run stopped at its target confirmation and changed nothing. Re-running the same `--dry-run --typecheck enable --codegen disable --env-file .env.local` command in a terminal completed with exit zero after confirming the production target.

The dry run validated the schema, reported no deleted indexes and listed 35 indexes that production would gain, including run claims, checkpoints, dispatch receipts, resource receipts, usage settlements and provider usage receipts. It also reported a Node action runtime configuration change. No deployment was committed. This is substantial production/development drift, not merely the latest sweep patch; a coordinated backend/frontend/worker rollout and compatibility review remains necessary. Local acceptance does not prove production behavior.

## Actual serving backend and deployment — 17 September 2026

The public site's JavaScript was inspected directly: `riftsys.app` currently configures `https://elated-poodle-998.eu-west-1.convex.cloud`, the same backend as the local preview. This was found in `/_next/static/chunks/042g8p-alng2e.js` under deployment `dpl_69h639AQ2cFthJfGiZ3sVB2zggzi`. The separate `content-robin-881` production deployment is not the backend currently served by this public site. Its dry-run index differences must not be presented as the cause of the current site's failures. Evidence: `/tmp/rift-public-backend-mapping.json`.

After reviewing the pending database changes and passing the full database suite and TypeScript, `pnpm exec convex dev --once --typecheck enable --codegen disable --tail-logs disable --env-file .env.local` exited zero. Convex reported functions ready at 04:23:07 local time (`/tmp/rift-current-backend-deploy.log`). This pushes the current database functions/schema to the actual serving backend without changing the site's backend URL, migrating accounts, or restarting web/worker processes.

A postdeployment call to `runs:reconcileStaleRuns` with `cutoffMs: 0, limit: 1` exited zero and returned `closedCount: 0, isDone: false` and a continuation cursor. The zero cutoff deliberately excludes real started runs; no user record was closed by this probe. Evidence: `/tmp/rift-backend-reconcile-probe.json`.

The previously observed live worker reported COMPLETED at 01:22:09 UTC, before this push; its completion is not attributed to the push. A fresh producer inventory still finds one unverified 404 and seven older terminal producers without cleanup-drain proof. No claims were forcibly released and no main process was restarted. Evidence: `/tmp/rift-deploy-producers-current.json`.

The latest complete web artifact `.next-ui-release-1789607600257-8026bee9` is separately served on `http://localhost:3064` and responds HTTP 200. Main preview 3020 and the public web bundle have not been upgraded by this database deployment. Worker retry changes likewise still need their own safe rollout.
