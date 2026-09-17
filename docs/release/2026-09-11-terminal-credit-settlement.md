# Inactive terminal credit settlement — 2026-09-11

The reservation primitives now have one immutable terminal settlement operation.
It accepts the original owner/amount/tier binding, revision 1, a pricing-policy
version, server-observed usage evidence, its canonical SHA-256 digest, and the
cumulative actual credit cost. It does not accept a caller-provided allocation.

The transaction stores the final receipt together with the account adjustment.
An identical retry returns that receipt; a different target or evidence under
the same identity is rejected. Only an in-use reservation can first settle.
Settled reservations cannot authorize more work or be refunded through close.

Lower actual cost restores the recorded purchased source first, then included
credits, bounded by the original allocation. Higher actual cost consumes current
included credits and purchased balance within the monthly spending cap; the
uncovered remainder becomes debt attributed to this settlement. No payment,
auto-reload, or legacy unkeyed debit/refund is dispatched. Unknown usage and
changed source lineage produce durable reconciliation-required results without
guessing an adjustment. Monetary counters and arithmetic must remain nonnegative
safe integers.

The digest establishes retry consistency, not the truth of provider invoices.
The authenticated server must derive evidence and pricing from its own observed
usage, never request-body usage. This first version permits one terminal target;
corrections and later evidence require a separate reconciliation protocol.

Verification before integration: 137 author-run tests across seven suites,
including 44 new settlement cases, both TypeScript checks, and scoped lint.
Independent review ran 81 actual-handler cases, including two extra probes for
independent positive/negative adjustments and debt. Root reran the four affected
backend suites after applying the reviewed patch. The patch changes no existing
unkeyed accounting or payment definition; its state additions affect only the
inactive reservation APIs.

The initial tests use simulated storage. Native Convex concurrent settlement
was subsequently exercised as described below. Transaction rollback fault
injection and caller integration remain outstanding.
All three caller paths still need a trusted identity before reserve, a first-use
grant, frozen usage evidence, and single-flight settlement that latches only after
the durable receipt. The original live response-loss defect remains open until
that integration passes.

Admission limitations are explicit: another settlement's new debt blocks fresh
reservations, but an already funded reservation can still obtain its first-use
grant. A later exact refund may leave purchased balance alongside attributed
debt; this slice introduces no automatic netting or debt forgiveness. Activation
must deliberately enforce current entitlement, suspension, task ownership and
the intended debt policy at the first-use boundary. It must not claim all future
dispatch is already blocked by these primitives alone.

## Isolated native Convex verification

Exact source `1b4ce9cd9d0e241c5d0bea829269d929837da721` was deployed from a
separate clean checkout to regional development deployment `artful-jaguar-288`,
with typechecking enabled. The active canary web checkout, main application,
real users and payment/provider credentials were not changed.

Twelve scenarios passed in 15.414 seconds with 148 requests through 148 separate
Convex clients and 13 generated synthetic ledger owners. Eight same-key terminal
requests returned identical receipts with one adjustment. Eight conflicting
targets committed one immutable winner (75 points); four opposite-target
requests were rejected. Replaying a deliberately discarded successful receipt
did not adjust the ledger again.

Three settlement/close races observed both outcomes: settlement won twice;
close sealed reconciliation once. Three independent positive/negative settlement
races all observed positive first, preserving net accounting with 50 purchased
points and 75 attributed debt remaining. These do not establish automatic debt
netting or both arithmetic orderings. Four invalid owner/amount/digest requests
left accounting unchanged. Unknown usage and revoked/regranted source lineage
sealed reconciliation without guessed refunds.

Evidence JSON: `/tmp/rift-credit-settlement-occ-ef7fb1a8-bb30-4f12-b5ff-7b3f4841bc66.json`,
SHA-256 `f3636f45ac4d483908499c82da4635b48d2353b90627c3f84d6205a4aeb61bc3`.
Reviewed harness: `/tmp/rift-credit-settlement-occ.cjs`, SHA-256
`33761403c87c8246ff6d64b6ac15cd6c314a81efddec3834a5ccc2b930cd8946`.

Finite monthly-cap concurrency was not exercised: the existing cap setter needs
ordinary user authentication, and no synthetic authentication bypass was added.
Concurrent HTTP requests do not prove overlapping transactions or force an OCC
retry. Consumer-side receipt discard is not a TCP interruption or transaction
rollback injection. Source was verified during deployment; the accounting APIs
do not attest a Git revision. Synthetic ledger rows remain for review.
