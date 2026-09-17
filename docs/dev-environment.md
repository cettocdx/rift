# Local development environment

RIFT is three processes, not one. If you only start two of them the app still
opens, still logs you in, and still accepts messages — but the Build path is
dead and nothing tells you. This page explains the processes, the env vars,
and what breaks silently when each is missing.

## Which command to run

| Command           | Starts                                            | Use when                                                            |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`        | `next dev` (:3010) + `convex dev` + `trigger dev` | **Default.** Anything that touches Build / long-running agent runs. |
| `pnpm dev:web`    | `next dev` (:3010) + `convex dev` only            | Pure UI / chat work where you know you will not start a Build run.  |
| `pnpm dev:cursor` | `next dev` (:3014, Cursor skin) + `trigger dev`   | Cursor-skin shell; already had the worker.                          |
| `pnpm dev:ui-preview` | `next dev` (:3020) + `trigger dev` | Reference UI in the browser and RIFT UI Preview desktop app. Runs `pnpm run doctor` first; both processes stop when either exits. |
| `pnpm dev:ui-preview:web` | `next dev` (:3020) only | Visual-only preview. Build agent runs require a separately running `pnpm dev:ui-preview:worker`. |
| `pnpm dev:all`    | same three as `pnpm dev`, default Next port       | Legacy alias; kept for muscle memory.                               |
| `pnpm doctor`     | nothing — prints the env table below and exits    | Any time something "just does nothing".                             |

`pnpm dev` runs `scripts/doctor.ts` first via the `predev` hook (pnpm 10 runs
pre-scripts by default). A missing **required** var aborts the start with
exit 1; missing **optional** vars only print a WARN row. `dev:web` has no
pre-hook; run `pnpm doctor` yourself when in doubt.

### Why `pnpm dev` now starts the Trigger worker

The Build agent path is `POST /api/agent-long` → Trigger.dev task
(`trigger/agent-long.ts`). The route only _enqueues_ the run. Something has to
pick it up: in production that is the deployed Trigger worker, locally it is
`trigger dev` running against your `tr_dev_…` key.

**A Build run started without a Trigger worker sits queued forever and shows
"agent start timed out"** — the POST returns 200, the run is created, the UI
waits 60 s for the first stream event (`AGENT_FIRST_EVENT_TIMEOUT_MS`), then
prints "RIFT could not start this agent run in time. Your message is saved —
retry or reconnect." Nothing in the Next or Convex logs explains it, because
from their point of view nothing went wrong.

The old `pnpm dev` only started Next + Convex, so this was the default local
experience. That pair is now `pnpm dev:web`; pick it deliberately.

The reference UI preview also needs its worker. Start `pnpm dev:ui-preview`
before opening `pnpm desktop:ui-preview`. The worker reads `.env.local`, and
both preview processes use `http://localhost:3020` as the app origin and the
current checkout as the local workspace. The preview uses the configured
Convex deployment without starting a Convex schema sync. If the web-only
preview is already running, `pnpm dev:ui-preview:worker` starts just the
missing worker. A worker must report **Local worker ready** before a Build
run can execute; an expired run needs Retry after it is ready.

## Environment variables

`scripts/doctor.ts` reads `.env.local` (shell-exported vars take precedence,
same as Next) and never prints values. `--json` gives `{ ok, rows }`.

### Required — doctor exits 1 if missing

| Name                      | Required by                      | Effect when missing                                                                                                                                                       |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRIGGER_SECRET_KEY`      | `/api/agent-long`, `trigger dev` | Build runs cannot be triggered; the route fails before a run exists. A `tr_dev_…` key means runs are picked up **only** by a local `trigger dev` (started by `pnpm dev`). |
| `TRIGGER_PROJECT_ID`      | `trigger.config.ts` (`project:`) | `trigger dev` has no project ref and refuses to start.                                                                                                                    |
| `NEXT_PUBLIC_CONVEX_URL`  | browser + server Convex clients  | Nothing loads.                                                                                                                                                            |
| `CONVEX_SERVICE_ROLE_KEY` | every server-side Convex call    | Auth, runs, billing and usage lookups all fail.                                                                                                                           |
| `OPENROUTER_API_KEY`      | `lib/llm`, all agent paths       | No model access; every chat and agent call fails.                                                                                                                         |
| `E2B_API_KEY`             | sandbox creation                 | Build and Secure runs fail at startup.                                                                                                                                    |

### Optional — silent no-ops when missing (doctor prints WARN, exit 0)

| Name                                                                                                 | Required by                                      | Effect when missing                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` **or** `KV_REST_API_URL` + `KV_REST_API_TOKEN` | `lib/rate-limit/redis.ts` (`createRedisClient`)  | Rate-limit, free-run lock, monthly cap **and** the mid-stream BudgetMonitor are disabled locally. Every limiter returns `rateLimitSkipped: true`, which also makes `captureBudgetSnapshot()` return `null`. You will never reproduce a quota bug without these. Both halves of one pair are needed; half a pair is treated as unconfigured. |
| `REDIS_URL`                                                                                          | `lib/utils/redis-pubsub.ts` (node-redis pub/sub) | Cross-instance Stop relay for streams is disabled; Stop still works in-process. This is a different Redis than the Upstash REST pair above.                                                                                                                                                                                                 |
| `NEXT_PUBLIC_POSTHOG_KEY`                                                                            | `app/providers.tsx`, `lib/posthog/logs.ts`       | Telemetry disabled.                                                                                                                                                                                                                                                                                                                         |
| `OPS_ALERT_WEBHOOK_URL`                                                                              | `lib/ops/alerts.ts`                              | Ops (Slack) alerts for run failures disabled.                                                                                                                                                                                                                                                                                               |

Everything else in `.env.local.example` (WorkOS, S3, Centrifugo, LemonSqueezy,
MCP credential keys, …) is feature-scoped and is not checked by the doctor;
the feature that needs it fails loudly on its own.

## Reading the doctor table

```
name                                             | status | effect
-------------------------------------------------+--------+-------
TRIGGER_SECRET_KEY                               | OK     | -
TRIGGER_SECRET_KEY (tr_dev_*)                    | WARN   | dev key: runs need `trigger dev` (started by `pnpm dev`)
UPSTASH_REDIS_REST_URL/_TOKEN (or KV_REST_API_*) | WARN   | rate-limit, free-run lock, monthly cap and BudgetMonitor are disabled locally
```

- `OK` — set.
- `MISSING` — a required var; the start is aborted.
- `WARN` — an optional var, or an advisory note. The app runs, but that feature
  is off and will not log anything about it.

## Quick triage

| Symptom                                                                        | First check                                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Build message accepted, spinner, then "could not start this agent run in time" | Is `trigger dev` running? Run `pnpm dev`, not `dev:web`.         |
| Free user never hits the 10-message/day limit locally                          | Upstash pair missing → limiter is a no-op.                       |
| Paid user never sees BudgetMonitor / monthly-cap warnings                      | Same: `rateLimitSkipped` short-circuits `captureBudgetSnapshot`. |
| No PostHog events                                                              | `NEXT_PUBLIC_POSTHOG_KEY` unset.                                 |
| Run failures never reach Slack                                                 | `OPS_ALERT_WEBHOOK_URL` unset.                                   |


## OpenCode Build engine (optional)

The Build agent can run on OpenCode inside the chat sandbox instead of the
legacy AI SDK loop. It is off unless one of these is set on the **Trigger**
worker:

| Variable | Effect |
| --- | --- |
| `BUILD_ENGINE=opencode` | Build runs (`purpose=app`, agent mode) use OpenCode; `BUILD_ENGINE_OPENCODE_PERCENT` (default 100) gates by a stable per-user bucket. |
| `BUILD_ENGINE_ALLOWLIST=user_1,user_2` | These users get OpenCode even when the global flag is off. |
| `OPENCODE_ENGINE_KILL_SWITCH=1` | Everyone back to the legacy loop, immediately. |
| `LLM_PROXY_BASE_URL` | Proxy base reachable from the sandbox; defaults to `https://riftsys.app/api/llm/v1`. |
| `LLM_PROXY_SECRET` | HMAC secret for per-run proxy tokens; must match the Vercel value. Falls back to `CONVEX_SERVICE_ROLE_KEY` on both sides. |

The proxy route (`app/api/llm/v1/chat/completions`) runs on Vercel and needs
Redis (`KV_REST_API_*` / `UPSTASH_REDIS_REST_*`, the same store the worker
writes run leases to) plus `OPENROUTER_API_KEY`. For local development without
Redis, `LLM_PROXY_DEV_NO_LEASE=1` lets the local proxy accept a verified token
without a lease (never active in production). `scripts/opencode-e2e.ts` drives
the whole path against a real sandbox; expose the local proxy with a
`cloudflared tunnel --url http://localhost:3010` and pass `PROXY_BASE_URL`.
Sandboxes older than image v15 install the pinned OpenCode binary on first use.
