# Account credit reservation primitives — 2026-09-11

## Problem and scope

A debit can commit even when its response does not reach the caller. The current
caller creates its refund identity only after receiving that response, so its
empty refund tracker can report success without restoring the debit. A retry can
then spend credits again. This is a release blocker, not resolved by the changes
in this document alone.

This batch adds inactive, service-authenticated Convex primitives for atomically
reserving credits, fencing the start of external work, and closing a reservation
before work starts. Existing callers, auto-reload, and settlement are unchanged.

## Invariants

- A server-created reservation identity binds the owner, amount, and tier.
  Repeating that identity reuses its recorded result; equal amounts on distinct
  identities remain distinct operations.
- Closing an unseen identity creates a tombstone. A delayed reserve cannot
  subsequently debit it.
- A close restores only the allocation recorded with the debit. It does not
  accept caller-supplied refund amounts.
- The ledger row ID and accounting generation prevent restoring a historical
  allocation after a downgrade, reset, revocation, or delete/recreate cycle.
  Ambiguous accounting leaves balances untouched and durably blocks admission
  with `reconciliation_required`.
- `newlyGranted` is true only for the first successful start-use transition.
  A replay or lost start-use response is not permission to dispatch work again.

Six existing writer paths advance the accounting generation when they replace
source accounting: external purchase revocation, debit rebasing, allowance
changes/resets, legacy usage migration, legacy plan refunds, and purchased-credit
refunds. Ordinary additive debit/purchase operations preserve it. The baseline
debit/refund arithmetic and authorization remain unchanged. Generation fencing
is conservative: an unrelated legacy refund may require reconciliation.

## Verification

The author ran 108 focused tests across eight suites, TypeScript, lint, and nine
actual-handler balance comparisons against `bb22b20` (identical apart from the
new generation metadata). Independent review reran 35 primitive cases and found
no remaining blocker for this inactive slice. Root applied the reviewed patch
and reran 78 focused tests across five suites; all passed.

The tests use actual handlers with simulated storage. They do not establish
native Convex conflict retry or rollback behavior. The separate
`artful-jaguar-288` deployment is the intended next concurrency-test target;
current user accounts and provider calls are outside that test scope.

## Activation gates

Before using these APIs, all three request paths must create a trusted identity
before the debit and bind it to current user entitlement and task ownership.
Recovery must retain that identity before awaiting the reserve response. Only a
fresh durable start-use grant may precede external work.

Full refunds and negative true-up must not run alongside keyed close. Positive
true-up needs a separate keyed cumulative settlement contract. Console settlement
currently marks itself settled before awaited accounting completes; changing
that requires idempotent settlement, not an unkeyed retry. Post-provider usage,
process-crash reconciliation, and external payment idempotency remain separate
work. No timeout-based refund or tombstone deletion is introduced.

The original lost-response caller regression remains failing in a separate
review fixture. No live billing resilience or production-readiness claim is made.
