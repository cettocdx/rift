# Project and migrated-chat namespace origin

Baseline: `c923783`. Worker process reuse remains disabled.

Project workspace identity was derived after asynchronous ownership/bot lookups,
using the environment at that later instant. A bound migrated-chat callback also
read its signing key at invocation. An offline A/B regression reproduced both
paths changing authority while the originating operation was still pending.
This establishes an unsafe reuse assumption, not a production cross-user incident.

The existing worker scope now captures the effective namespace secret alongside
its sandbox configuration. The resolver also copies the explicit override or
captured value at entry, covering unscoped HTTP callers across their awaits.
Validation stays at the original signing step, after authorization.

Compatibility is deliberate: explicit override, project secret, then service-key
nullish precedence; an explicit empty value still fails instead of falling back.
The v1 salt, HMAC bytes and resulting identities are unchanged. Existing project
bindings still take priority over migrated chat bindings. Native unbound
workspaces require no namespace key. No secret is added to payloads or telemetry.

Verification: 10 meaningful origin assertions failed before the fix while four
preservation checks passed. The fixed focused run passes 73 tests across eight
suites, including 14 new tests using actual Node HMAC and AsyncLocalStorage.
Ownership completion is an injected deferred dependency, not a live database.
Full TypeScript, scoped lint and diff checks passed. Detailed logs are referenced
in `/tmp/rift-namespace-origin-evidence.md` and the external milestone report.

This does not measure startup savings, validate live key rotation, or certify
process reuse. External callbacks still need their originating scope bound;
unscoped standalone synchronous calls retain call-time configuration behavior.
