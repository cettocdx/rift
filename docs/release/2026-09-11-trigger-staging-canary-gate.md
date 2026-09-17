# Trigger worker inventory and staging canary gate — 2026-09-11

This records the read-only inventory performed during the startup audit. It is a point-in-time observation, not evidence that a canary was deployed or that production is ready to promote. No deployment, schedule edit, environment write, authentication change, or paid task was performed for the inventory. No secret values are included here.

## Observed environments

The existing authenticated Trigger CLI session can access project **RIFT** (`proj_tzdasuzvmzpcjmlcafvs`) in organization `rift-8a1b`. The installed CLI is **4.5.4**.

| Environment | Observed state                                                                                                                                           | Consequence                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production  | Current deployment `20260902.2`, `deployment_yybc88pzpx8fv8aqpnd98`, status `DEPLOYED`, deployed `2026-09-02T13:02:41.440Z`                              | This older hosted worker is not the locally benchmarked development worker.                                                                               |
| Production  | Three active schedules listed below                                                                                                                      | A full-directory deployment is not an isolated agent canary. Leave these schedules unchanged.                                                             |
| Production  | Convex URL and service credential both compare equal to the release preview configuration; that Convex deployment is development                         | The Trigger environment label does not establish data isolation. Equality was compared in memory; neither value was printed or retained in this document. |
| Staging     | Environment exists; inventory returned only Trigger system environment variables, no application secrets, no usable current deployment, and no schedules | Staging is available as a target but is not configured to run this application.                                                                           |

Production schedule inventory:

| Task                        | Cadence              | Schedule ID                   |
| --------------------------- | -------------------- | ----------------------------- |
| `scheduled-task-dispatcher` | Every minute         | `sched_7myxqw3e8k23hwvk2qa98` |
| `keep-warm`                 | Every five minutes   | `sched_k2am8iwagzn5wa2h5usnw` |
| `ops-credits-check`         | Every thirty minutes | `sched_2ssfx1fs5trkyikvrj5ea` |

Production application configuration included Convex, model-provider, E2B, Redis, MCP credential keyring, and Centrifugo bindings. The remote relay binding differs from the preview's loopback relay. These observations do not establish that the credentials are valid or appropriately isolated for a canary. Staging application bindings were absent; none were copied or provisioned.

The local LaunchAgent `app.riftsys.ui-preview-worker` runs from `/Users/cetto/RIFT-Release`, uses the Trigger CLI development worker with `--env-file .env.local`, and has `KeepAlive` enabled. Its environment key is a development key. Consequently, the existing local startup samples measure the development-worker path; they do not establish hosted production-worker dispatch latency.

## Evidence basis

The earlier inventory used the installed CLI's existing login session through `isLoggedIn`, read-only `CliApiClient` project/environment metadata, and environment-scoped `ApiClient` deployment, schedule, and environment-variable GET methods. Environment-variable responses were reduced in memory to names and the explicitly stated equality checks; raw responses and credentials must not be put in logs or artifacts. Local LaunchAgent metadata and the repository configuration were inspected read-only.

Reproducible source references for the installed interface are `node_modules/trigger.dev/dist/esm/apiClient.js` (`getProject`, `getProjects`, `getProjectEnv`), `node_modules/@trigger.dev/core/dist/esm/v3/apiClient/index.js` (`listDeployments`, `listSchedules`, `listEnvVars`), and `node_modules/trigger.dev/dist/esm/commands/deploy.js` (deployment flags). These are installed-package paths, not committed source. Recheck inventory immediately before any future deployment; this document does not freeze remote state.

Repository task discovery currently uses `dirs: ["./trigger"]` in `trigger.config.ts`. That directory contains the agent plus the three schedule definitions in `trigger/scheduled-tasks.ts`, `trigger/keep-warm.ts`, and `trigger/ops-credits-check.ts`. The config loads `.env.local` unless `NODE_ENV=production` and includes a `syncEnvVars` build extension. Those defaults require explicit handling for an isolated build.

The documented mechanisms are [deployment and versioning](https://trigger.dev/docs/deployment/overview), [deploy CLI flags](https://trigger.dev/docs/cli-deploy-commands), and [scheduled-task lifecycle](https://trigger.dev/docs/tasks/scheduled). CLI syntax below was also verified against installed 4.5.4 source; it was not executed in this audit.

## Isolated staging canary preparation

Staging canary preparation is authorized work. The reviewed task-only configuration and restricted launcher are implemented; see [configuration and offline evidence](2026-09-11-trigger-staging-canary-config.md). No canary deployment is evidenced here. The executable preflight requires verified isolated bindings and a reviewed task manifest. Do not deploy the ordinary production config as a shortcut.

1. Use a separate checkout with the reviewed `trigger.canary.config.ts`, `trigger.shared.ts`, `trigger-canary/agent-long.ts`, and launcher. The canary imports the pure shared factory, not the ordinary config that loads development credentials. Run the offline configuration tests and graph verifier documented in the configuration report. The only registered task must be `agent-long`, with no schedules or other task registrations. The static graph is a preliminary check; runtime indexing of the exact built bundle remains required.
2. Establish and verify isolated **nonproduction** Convex and Redis bindings, and a dedicated ordinary QA identity owned by the tester. The canary API and worker must agree on `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_SERVICE_ROLE_KEY`, the effective Redis pair (`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_URL`/`KV_REST_API_TOKEN`), and their authentication/account mapping. Avoid conflicting fallback Redis pairs. Redis usage keys have shared prefixes, so a separate Trigger environment alone does not isolate quotas, leases, or billing state. Do not reuse the current production/preview service binding.
3. Verify staging provider/sandbox credentials for the intended small test scope. Review MCP keyring and relay requirements if those features are exercised. The isolated API must send the isolated Convex destination in its run payload; the worker supports a per-run destination, so checking only its default environment URL is insufficient. No forged sessions or service-auth substitution for the QA user's normal API authentication.
4. From the isolated checkout run the restricted launcher below. It allows only home/path/temp/locale/terminal environment variables into the CLI child, fixes staging and the task-only config, prevents local dotenv loading and secret synchronization, and defaults to dry run. It still uses the existing CLI login and remote staging variables. The dry run contacts Trigger and builds; it is not an offline check.

```sh
node scripts/trigger-staging-canary.cjs
```

Review the generated build output and capture a successful exact-bundle worker manifest through `indexWorkerManifest` or an equivalent reviewed discovery procedure. Installed CLI 4.5.4 catches local indexing failures, so neither a successful dry-run exit nor `build.json` proves task isolation. The manifest must contain only `agent-long` and no schedules.

After isolated bindings and manifest checks pass, `node scripts/trigger-staging-canary.cjs --deploy` removes only the dry-run flag. It keeps staging, the task-only config, environment filtering and promotion disabled. Verify deployed task inventory contains only `agent-long` and staging schedule inventory remains empty before making any test request. Do not use the ordinary whole-directory config. These commands have not been executed in this audit.

Use a separate canary API instance configured with the staging `TRIGGER_SECRET_KEY` and set `TRIGGER_VERSION` to the exact version returned by this staging deployment. Installed SDK `node_modules/@trigger.dev/sdk/dist/esm/v3/shared.js` maps explicit `options.version` or `TRIGGER_VERSION` to `lockToVersion`. Verify the admitted run reports that environment and version before accepting latency evidence. Do not change the existing preview or production API environment to obtain the comparison.

Once the isolated bindings, QA identity, task manifest, deployed version, and empty staging schedule inventory are verified, start with one ordinary authenticated QA request through the canary API, then a bounded matched scenario sample if correctness holds. Compare the same model/effort/scenario and report route dispatch separately from dispatch-to-worker-start. A hosted worker may reduce the development handoff cost, but no improvement has been measured by this audit.

Stop/rollback means stop sending canary requests, cancel only identified canary runs through the normal authorized path if necessary, and stop the separate canary API. Because the canary is staging and unpromoted, the production deployment and its schedules need no rollback or modification. Do not delete shared resources as cleanup. Any eventual production promotion is a separate rollout decision, with its own review of production bindings and active schedules.

## Current gate

**Hosted canary acceptance is blocked on missing verified isolated Convex/Redis bindings, an ordinary QA identity for those bindings, and completion of deployment preflight.** Production still has active schedules and shared preview data access. At inventory time, staging had no application secrets. The task-only configuration and restricted launcher have passed offline review and tests; exact-bundle indexing and hosted acceptance remain outstanding. These are concrete configuration and verification gaps, not a request for additional permission to perform staging preparation and testing. Production promotion remains a separate rollout decision; the inventory alone establishes no hosted latency improvement.
