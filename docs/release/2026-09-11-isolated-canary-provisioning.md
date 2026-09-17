# Isolated canary provisioning — 2026-09-11

This follows the [read-only inventory](2026-09-11-canary-resource-readiness.md)
and [reviewed task-only configuration](2026-09-11-trigger-staging-canary-config.md).
It records resource preparation, not a hosted latency result or release approval.

## Convex

A new nondefault development deployment, `artful-jaguar-288`, was created under
`dev/hosted-canary-20260911` in project 2172515, region `aws-eu-west-1`. It expires
2026-09-18 at 03:15:35.883 UTC. Management re-listing confirmed that the existing
`dev/william` and `production` defaults were unchanged. No purchase or upgrade
prompt occurred.

The isolated checkout is `/tmp/rift-hosted-canary-backend-20260911`, based on
`c239cc1`, with its own mode-0600 deployment selection file. Fresh service and
RS256 signing keys were generated locally; dotenv round-trip and signature
verification passed, and comparison with release keys showed distinct authority.
Only `CONVEX_SERVICE_ROLE_KEY`, `JWT_PRIVATE_KEY`, `JWKS`, and
`SITE_URL=http://localhost:3024` were written to the new deployment. No current
users, sessions, payment credentials, storage credentials, or alert webhooks were
copied. Deployment of `c239cc1` completed with typechecking enabled and codegen
disabled. The public JWKS and OIDC discovery endpoints returned HTTP 200; the
single public key matched the newly generated authority and the issuer matched
the new deployment. Root independently repeated both public endpoint checks.
The function inventory reported 300 functions, including worker snapshot and
account debit functions. Remote readback contained exactly the four approved
variables, matching their private local values.

Three real-server negative checks passed against this isolated deployment:
anonymous account settings returned no account data; a backend balance query
with an invalid service key was explicitly rejected; and an invalid-key debit
mutation was explicitly rejected. The debit used a synthetic identifier and no
valid debit was submitted. This is a basic authorization check, not two-user
isolation or successful ordinary login acceptance. Evidence:
`/tmp/rift-canary-auth-negative-20260911.json`.

## Redis

The documented [temporary Redis provisioning endpoint](https://upstash.com/docs/agent-resources/cli)
returned a new resource response, expiring 2026-09-14. The response and parsed
credentials are held in a private mode-0700 directory with mode-0600 files.
Capability-bearing database identifiers and claim links are not included here.
No account claim, paid-plan selection, or connection to the existing production
project was performed.

The endpoint resolves in DNS, but initial Node and Python REST probes failed;
a separate TCP port-443 probe timed out. No successful PING or empty-store check
has yet been obtained. Therefore this resource is **not an accepted Redis
binding**. A successful provisioning response alone does not establish usability.
Independent diagnosis confirmed that both resolved IPv4 addresses fail TCP
port 443 before TLS or authentication, while Upstash website/API control hosts
connect. The URL and token match the original private response. Endpoint
provisioning/routing trouble versus selective network blocking remains unproven;
this temporary resource remains unclaimed and is not used.

A separate managed Vercel/Upstash resource, `rift-hosted-canary-20260911`
(`store_lsUf6pWVcapfanaf`, region `dub1`), subsequently passed HTTP-200 PING
(`PONG`) and DBSIZE (`0`) checks. Management readback reports owned/available,
Free billing, no required payment method or preauthorization, and both automatic
paid upgrade and production pack disabled. It has zero connected projects.
Independent inventory comparison confirmed that the existing shared store's
metadata and connections were unchanged. This is the accepted canary Redis
candidate; it has not yet been bound to Trigger or used by a live task.

Its separate credentials are held in a mode-0600 file inside a mode-0700
directory. Nonsecret verification evidence is
`/tmp/rift-managed-redis-private-20260911/verification-summary.json`. No existing
Redis credential was substituted, and no existing application binding changed.

## Source and runtime checks

Commit `c239cc1` passed the ordinary commit checks: TypeScript, lint, local CLI
integrity, 625 Jest suites, 5,649 passing tests, one existing skip, and 24 snapshots.
Five focused offline canary checks also passed. The local development worker
rebuilt normally as `20260911.14`; the existing web server returned HTTP 200.
No hosted Trigger worker has been deployed through the new launcher.

## Remaining live gates

The separate API, ordinary QA signup/sign-in, canary-only Redis binding,
provider/sandbox bindings, successful exact-bundle Trigger indexing, staging
deployment, exact-version admission, and empty staging schedule inventory are
still required before the hosted benchmark. Current authenticated preview
measurements must not be labeled isolated hosted measurements. No existing
user credit top-up was needed or performed during this preparation.
