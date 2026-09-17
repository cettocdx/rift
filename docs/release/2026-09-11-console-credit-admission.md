# Console production credit admission

The additive console path stores a server-generated request binding atomically
with its reservation. Production admission reads the current subscription tier,
active suspension, unique account ledger, source generation/cycle and outstanding
debt in the transaction that grants first use. It grants once. The weaker
accounting-only start-use endpoint refuses production-bound reservations.

A confirmed denial before first use closes the key and restores its exact
sources when those sources remain valid. Changed lineage remains unresolved;
zero-source reservations can close without any refund arithmetic. A closed key
cannot reopen after account eligibility changes. This operation neither clears
another request's debt nor retries model execution.

Existing reserve and close handlers were extracted as transaction-local
definitions and reused. Independent AST comparison found their bodies unchanged.
No nested RPC or duplicate debit/refund arithmetic was introduced. Unbound
primitive fixtures retain their existing behavior. Worker and HTTP chat
production bindings are not part of this phase.

Thirty new actual-handler cases passed with real subscription and suspension
fixture reads. The author ran 146 tests across seven suites, TypeScript, Convex
typechecking and scoped lint. Independent review ran 37 cases, including seven
additional zero-cost, ledger-replacement, period-rollover, purchased-source
refund and cross-owner isolation cases. These use array-backed storage, not
native Convex concurrency or transaction rollback injection.

Reviewed patch SHA-256:
`afb4069f4964c11596047b68ea7a43641eb57d274c740b6b31fb0bc545db8415`.
The source worktree and review artifacts are recorded in
`/tmp/rift-credit-production-admission-review.md`.

## Isolated deployment acceptance

Backend commit `d21e1695df0d59000a61e6e3315e429c9dcaaa47` was deployed with
normal typechecking to `dev:artful-jaguar-288` from its own clean checkout.
Twelve scenarios passed in 15.134 seconds: 148 requests through 148 fresh clients,
using 13 synthetic owners. Eight simultaneous admission requests produced exactly
one new grant. Expiry, suspension and debt denials restored the request's original
sources once; revoked lineage remained unresolved. Binding violations and weak
admission bypasses were rejected. Discarding a delivered grant and replaying did
not grant again. Close won all three close/admission race samples.

The test did not force OCC retries, inject rollback or actual TCP response loss,
exercise finite-cap concurrency, or authenticate an ordinary user. It used no
real user credits, model requests or payments. Main application and caller flags
were untouched.

Evidence SHA-256:
`ecf2ebbd63a0b26024f50080e8821c5639817ce94de75d8d0c7f2dde284fb4b8`.
JSON: `/tmp/rift-credit-production-admission-occ-000d01a3-6fcb-4bf7-887c-1d5a685b033f.json`.
Deployment log: `/tmp/rift-admission-occ-deploy.log`.

The console gate remains off pending authenticated end-to-end acceptance and
operational reconciliation. The server still authenticates each request and checks its
AbortSignal before and after admission. Database authorization cannot atomically
observe that signal or establish whether an SDK request was sent after a lost
reply. An uncertain first-use response never grants execution or a guessed
refund. Process-crash reconciliation and free/team/auto-reload migration remain
separate release work.
