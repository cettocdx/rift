# Durable evidence for terminal credit adjustments

Both the HTTP chat finalizer and the Build/Hack worker finalizer now persist an
immutable per-owner/run intent before invoking their existing credit adjustment.
The intent contains resolved cost/token evidence, pricing, prepaid allocations,
subscription and funding options. It contains no prompts, credentials or raw
exception messages.

Only the transaction creating the intent returns permission to perform the
unkeyed adjustment. Even an identical replay returns false: a missing response
does not permit a second debit. Pending and uncertain rows are retained without
expiry and are available through a service-authorized paginated recovery query.

The finalizer records `acknowledged` when its adjustment callback returns, or
`uncertain` when it throws. These describe the observed legacy callback outcome,
not a new atomic payment ledger. A lost result receipt is retried only with the
same attempt and outcome. The debit itself is never retried by this journal.
If receipt writes fail, the original pending intent remains discoverable. A
timed-out begin never invokes the debit even if its response arrives later.

This closes loss of terminal adjustment evidence; it does not solve automatic
reconciliation or migration to atomic account-credit settlement. A worker killed
before reaching terminal finalization still has provider receipts, but may have
no terminal intent or final non-model cost. Historical adjustments are not
backfilled. Existing legacy callback semantics (including funding shortfalls)
still apply and must not be inferred away from an acknowledged callback.

Backend deployment must precede publishing the new web build. The source-watching
development worker also requires that backend schema/functions before accepting
new live validation work. Durable Hack rollout flags remain disabled.

Validation covers one-shot election, immutable evidence, account/run/attempt
isolation, terminal receipt replay/conflicts, missing/late acknowledgments and
storage failures. Production closure tests exercise the actual settlement
functions in HTTP, Build and Hack sources for free, balance and account channels.
These are fault-injection tests, not proof of hosted process-death recovery.
