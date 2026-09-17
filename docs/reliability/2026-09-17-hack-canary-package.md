# Dedicated Hack canary package

The main application still uses the HTTP Hack producer while durable admissions
are disabled. Its 370-second report reserve / 420-second request ceiling is not
background worker durability. Reader resumption through Redis does not remove
that ceiling or survive an HTTP producer process death.

The previous isolated staging entry exported only `agent-long`. It could not
exercise `/api/hack-long` end to end. A separate opt-in profile now includes both
`agent-long` and `hack-long`; the original Build-only profile stays available.
The shared agent module necessarily registers Build while creating the Hack
factory, so both task IDs are explicitly expected. Neither profile discovers the
ordinary scheduled-task directory.

Commands:

```sh
node scripts/verify-trigger-canary-graph.cjs --hack
node scripts/trigger-staging-canary.cjs --hack
```

The launcher still fixes staging, defaults to a dry run, skips promotion and
secret synchronization, ignores local dotenv files, and strips inherited app
credentials. `--deploy` remains explicit. This profile does not enable the main
application's admission flags or restart its workers.

## Verification

- Two regression tests first failed: the graph scanner omitted a factory called
  from another module and omitted a renamed factory import in the entry itself.
  It now discovers definitions before resolving named imports and call sites.
  Evidence: `/tmp/rift-hack-canary-red.log`.
- All ten config/launcher/graph tests pass, including the original Build-only
  profile, schedule rejection, unexpected task rejection, and the separate Hack
  directory. `/tmp/rift-hack-canary-tests.log`.
- Scoped ESLint, full TypeScript (`tsc --noEmit`), and whitespace checks pass.
  TypeScript evidence: `/tmp/rift-hack-canary-typecheck.log`.
- The real Trigger 4.5.4 dry run built
  `.trigger/tmp/build-ytfpWn`, but its best-effort skill-discovery warning means
  exit zero alone was not accepted. `/tmp/rift-hack-canary-dry-run.log`.
- The deploy manifest uses `/app/` container paths. A diagnostic copy localized
  only those paths to the generated directory. Declared dependencies were linked
  from the installed pnpm store at exactly the generated package versions:
  import-in-the-middle 3.0.1, node-pty 1.2.0-beta.12, Playwright 1.55.0, sharp
  0.34.5 and undici 7.25.0. No emitted JavaScript was edited and no application
  credentials were passed to the indexer.
- The actual generated managed index worker then loaded successfully and returned
  exactly `agent-long` and `hack-long`. This is local exact-bundle discovery on
  Node 22/macOS; it does not prove Linux container startup or hosted execution.
  `/tmp/rift-hack-canary-manifest.json`, `/tmp/rift-hack-canary-index.log`.

## Current staging state and remaining acceptance

An authenticated read-only inventory of the intended staging environment on
2026-09-16 23:59 UTC returned no application variables, no deployments, and zero
schedules. `/tmp/rift-hack-staging-inventory.json`. No environment write,
deployment, promotion, schedule mutation or paid task was made in this turn.

Next: revalidate the previously provisioned isolated Convex/Redis authorities,
complete an ordinary QA identity, bind the isolated API and worker consistently,
then deploy this exact task profile without promotion. Verify the hosted task
manifest and empty schedule inventory again. Exercise a bounded authenticated
Hack request, detach/reconnect to the same producer, cross the legacy HTTP time
ceiling, and verify exact-dispatch Stop plus remote cleanup. These are outstanding
live gates; the ten offline tests do not establish them. Main runtime rollout
remains pending those checks and a fresh maintenance gate.

Local credential recovery is also outstanding: the previously documented temporary
backend checkout and managed Redis private directory no longer contain their
credential/environment files. Their old verification reports are not current
credentials or evidence of a usable binding. The documented Convex canary expiry
is September 18; inspect its actual control-plane state before choosing it.
