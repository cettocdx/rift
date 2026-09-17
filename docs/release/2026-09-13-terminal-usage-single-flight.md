# Terminal usage finalization shares its outcome

The web chat and long-running Build/Hack worker used `hasRecordedUsage` before
awaiting debit acknowledgment. A concurrent finalizer returned successfully and
released the free-run lock while the original debit was pending. After a debit
rejection, subsequent finalizers silently returned success instead of observing
the accounting failure.

Both paths now retain one settlement promise, including its rejection. They
compute sandbox cost and the usage snapshot once and share the same outcome.
The callback is deferred until the promise is installed, covering synchronous
failures too. The settlement-owned free-run lock release happens once after
that attempt finishes. Independent resource cleanup remains unchanged.

No debit retry was introduced. Current unkeyed account/balance/free-cost writes
cannot safely be replayed after an acknowledgment is lost: a write might already
have committed. This change is in-process coordination, not durable or globally
idempotent billing. Worker death still requires an immutable persisted usage
intent and atomic same-key accounting receipt before automatic reconciliation
can be enabled. Recorded run cost remains observed cost, not proof of payment.

Verification: all 18 new concurrent success/failure boundary cases initially
failed on premature lock release. They now pass across web, Build and Hack, each
with account, balance and free allowance. Rejected replay retains the original
error, invokes the debit once and does not emit success telemetry or usage logs.
The eight related suites pass 109 tests. These execute real settlement closures
with controlled debit boundaries; they are not live provider or network tests.
