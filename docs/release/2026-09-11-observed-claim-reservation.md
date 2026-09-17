# Observed predecessor reservations

An immutable delayed start request could reacquire its original claim after a
second generation had replaced and released it. This also reproduced before the
sticky-cancellation change. Current routes use fresh private UUIDs; automatic
transport replay in the installed caller has not been demonstrated.

The additive `agentRunClaims.reserveObserved` endpoint requires the claim ID
observed before attempting a new reservation, including explicit `null` when no
claim existed. The transaction installs a new generation only if this predecessor
still matches. Existing ownership, duplicate-row, chat mapping and remote-run
takeover checks remain in force. Same-current live unbound retries remain
idempotent without extending the startup lease. Canceled, expired, active and
released current generations cannot be readmitted.

This is bounded predecessor comparison, not permanent historical ID retirement.
Callers must use fresh IDs and preserve the original observation on any retry.
Deliberately rebasing old IDs or deleting retained claim rows defeats a broader
historical guarantee. Legacy `reserve` retains its contract and remains outside
this protection; no legacy fallback is appropriate for the migrated callers.

The backend and caller patches are separate so the hot-reloading worker cannot
call an endpoint before its deployment is verified. No caller migration or main
backend deployment is included in this backend commit.

Author validation passed 163 tests across five suites, full and Convex TypeScript,
lint and an AST comparison of the legacy handler. Independent review passed 113
tests and added three actual-handler regressions for expired leases, a missing
predecessor row and a retained claim after chat deletion. Root ran 48 tests across
the observed reservation and cancellation suites with all passing. These fixtures
exercise serial transaction histories, not native concurrency or forced OCC.

Backend patch SHA256:
`7ab883081bc2f8c6ecd04a717827a89f25f3d08c2355b1cac92fcac8e0ab467d`.
Separate caller patch SHA256:
`54baa560607aec359f6773115d999a4c3f841f1f5ffd2ffd162384f3c439f5a8`.
Independent regression patch SHA256:
`16d0f483c3547130754e256348fe3298dcc14e984dcda0121968558977fa66a9`.

A separate bounded native harness is prepared for the isolated
`dev:artful-jaguar-288` deployment. It has not yet been run against this exact
backend commit. It must verify the regional destination and deployed API metadata,
use only namespaced synthetic fixtures, and confirm exact-generation cleanup.
