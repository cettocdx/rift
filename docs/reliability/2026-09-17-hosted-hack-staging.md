# Hosted Hack staging readiness

This advances the durable worker acceptance gap behind the mobile Build/Hack
report. Existing mobile viewport, Activity, preview and transcript fixes remain
in the separate 3077 release. It does not claim those fixes are public or that
long-task reliability has passed in production.

## Isolated bindings

- Recovered the existing nondefault Convex canary `artful-jaguar-288`, verified
  its control-plane identity, and deployed current Convex functions with
  typechecking enabled. Its expiry remains September 18, 2026 at 03:15:35 UTC.
- The Convex CLI unexpectedly rewrote the release checkout's three local
  deployment URL/selection entries despite an explicit selection env file.
  Those entries were immediately restored to `elated-poodle-998` and checked.
  Future canary commands must run in the separate snapshot, not the release
  directory. This was a local configuration side effect, not a production
  backend deployment.
- Reconnected the existing separate Redis resource
  `rift-hosted-canary-20260911` to the development environment of a new empty
  Vercel project, `rift-worker-acceptance-20260917`. The original RIFT project's
  local link remains unchanged. Redis PING returned PONG and DBSIZE returned 0.
- Compared Convex destination, service authority and Redis destination against
  the main configuration in memory: all isolated. Staging readback matched the
  seven explicitly selected worker bindings. No customer sessions, payment
  configuration or relay credentials were copied. Two nonsecret runtime flags
  were subsequently configured as described below.
- Prepared a separate current-source API snapshot at
  `/Users/cetto/RIFT-Worker-Acceptance-20260917`, served on 3078. Its login route
  returned HTTP 200. This is a development API for hosted-worker acceptance,
  not a production frontend performance result.
- Configured the ordinary OTP sender on the isolated backend and initiated a
  normal signup for the owner's email. Verification is pending; no session was
  forged or substituted with a backend service credential. No paid task has
  been admitted through this canary yet.

## Deployment defects found through real Linux builds

The first deployment failed before application indexing because the Mac's
Docker config referred to the removed `docker-credential-desktop` executable.
The controlled launcher now gives Depot a private temporary Docker config with
no unrelated registry credentials. It preserves the user's Docker config and
removes its temporary directory after success or a spawn exception. The new
regression failed first, then the full eleven configuration/launcher/graph
checks passed. Scoped lint and full TypeScript also passed.

The next build reached the managed Linux indexer but rejected the canary config.
Installed Trigger 4.5.4 `managed-index-controller` fetches environment variables
from the staging API and passes only that set to its child. It does not inherit
the image's environment. Therefore adding an image ENV instruction was
insufficient; that experimental change was removed. Direct inspection confirmed
both NODE_ENV and RIFT_TRIGGER_CANARY were absent in the actual indexer set.
Staging now explicitly contains NODE_ENV=production and
RIFT_TRIGGER_CANARY=staging. The guard and the launcher's staging-only,
no-promotion, no-secret-sync restrictions are preserved.

## Evidence and remaining boundary

Hosted version **20260917.4**, deployment
`deployment_jnbjmdtvhbah8r8hrw218`, is now **DEPLOYED** on **linux/amd64**.
The authenticated deployment API confirms exactly `agent-long` and `hack-long`
in its worker manifest. A fresh schedule inventory remains empty. Content hash:
`0a428e7ea5130addfa3b7265ad02fa62`. The deployment command retained
`--skip-promotion`; the separate 3078 API is pinned to this exact version.
This confirms hosted image building and task discovery, not a completed task.
The staging `current` tag still has no worker, confirming that this version was
not promoted. The separate API's unauthenticated Hack POST returned 401 and
did not admit a run.

- `/tmp/rift-canary-docker-red.log`: new isolation regression failed.
- `/tmp/rift-canary-final-tests.log`: eleven checks passed.
- `/tmp/rift-canary-hosted-typecheck.log`: TypeScript passed.
- `/tmp/rift-canary-image-lint.log`: scoped lint passed.
- `/tmp/rift-canary-convex-current-deploy.log`: current isolated backend deployed.
- `/tmp/rift-hack-staging-binding-0917.json`: initial seven-binding equality check
  and zero staging schedules, before the two runtime flags were added.
- `/tmp/rift-hack-hosted-deploy-bound-0917.log`: successful hosted deployment.
- `/tmp/rift-hack-hosted-current-manifest-0917.json`: deployed version, Linux
  platform, exact two-task manifest and zero schedules.

The main HTTP Hack path still has its legacy request ceiling while durable
admission is disabled. Reader reconnection tests alone do not remove that
ceiling. Verified QA login, a real task crossing
the HTTP ceiling, repeated detach/reattach, Stop and remote cleanup acceptance
are required before changing the main admission flags. Production promotion and
main process restart have not been requested by this launcher.
