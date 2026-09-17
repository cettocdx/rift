# Automatic settlement: required migration, not yet enabled

## Source audit

The HTTP preflight in `lib/api/chat-handler.ts` and worker preflight in
`trigger/agent-long.ts` still call `checkRateLimit`. Their terminal callbacks
use `settleWithJournal` around legacy adjustments. That journal prevents a
second debit but cannot determine whether a lost legacy debit response committed.
`convex/crons.ts` has no automatic settlement recovery job.

The console route has a conditional `AccountCreditLifecycle.forProductionConsole`
path, guarded by `RIFT_CONSOLE_KEYED_CREDITS_ENABLED`, personal pro/ultra eligibility,
and disabled auto reload. Its presence does not establish runtime activation or
coverage of Build, Chat, team, balance, or free accounting.

The production binding validator currently permits only `console_model` plus
a server-created request ID. `forAgentRun` is not a production admission contract:
checking nonempty claim/chat strings in the adapter does not prove ownership.

## Implementation order

1. Extend production admission with server-owned HTTP execution and worker
   claim/run identities. Validate ownership, cancellation, current entitlement,
   suspension, debt and source generation in the transaction granting first use.
   A rejected or repeated grant must never authorize model/tool execution.
2. Replace each eligible preflight debit with the keyed reservation, including
   its error/refund path. Preserve the original source allocation and pricing
   margin. Do not reserve once through each implementation. A failed keyed path
   must not fall back to an unkeyed debit after a possibly committed reservation.
3. Persist the immutable terminal usage target and digest before attempting
   settlement. Retain the original funding period, allocation and operation ID.
   Store complete non-model costs, not only provider token receipts. A process
   that dies before a complete target is known remains unresolved.
4. Schedule durable retries only for those keyed targets. Reuse the exact target
   and identity. Persist the next attempt, bounded backoff and final receipt;
   cap work per batch and make concurrent recovery workers harmless. The ledger
   adjustment and receipt must commit together. Source changes and incomplete
   usage remain explicit reconciliation cases, not guessed refunds or zero cost.
5. Integrate personal accounts, prepaid balance, team pools and free accounting
   with their respective authoritative stores. Preserve spending caps, owner
   pricing, subscription cycles and payment idempotency. Account-only rollout
   is an intermediate stage, not completion of automatic reconciliation.
6. Keep historical legacy pending/uncertain rows outside the replay queue.
   They need independently attributable adjustment evidence or an explicit
   reviewed accounting correction; provider cost alone cannot prove debit state.

## Required verification before activation

- Lost reserve acknowledgment, cancellation before/after reservation, and two
  simultaneous first-use attempts: at most one execution grant and one debit.
- Wrong user/chat/run/claim, canceled execution, revoked entitlement, changed
  accounting generation and existing debt: no new work or cross-owner adjustment.
- Process death before target persistence: no inferred settlement. Death after
  target persistence, during adjustment and after commit before acknowledgment:
  recovery reaches the same receipt with exactly one net adjustment.
- Duplicate scheduling and concurrent recovery: immutable target, no double
  charge, no repeated external payment, no loss of included/purchased allocation.
- Unknown usage, incomplete tool costs and changed billing cycle: retained
  unresolved state, with no silent success or automatic destructive correction.
- Full HTTP, Build, Hack and console runs exercise the enabled implementation;
  source-only tests and disabled feature branches do not prove integration.
- Native transaction concurrency plus live worker interruption supplement unit
  tests. The complete repository gate and clean build must pass before rollout.

Deploy backend contracts first because the development worker watches source.
Enable only after integration validation, then verify the actual running build
and backend. Keep existing immutable evidence during rollback.

## Current validation constraint

The host continued to report load averages above 300 on September 14. No full
suite or build was started during this audit. The prior focused overflow fix
passed 56 tests; the atomic cleanup optimization passed 146 focused tests but
still awaits its full commit gate. This document records the migration contract,
not an implemented or published automatic reconciler.
