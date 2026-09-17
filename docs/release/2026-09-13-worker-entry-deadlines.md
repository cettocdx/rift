# Bound worker lifecycle acknowledgment waits

The cleanup-required Hack worker awaited three lifecycle mutations without a
transport deadline: exclusive entry, effects permission and early cleanup. A
request that never resolved could strand worker setup or its early finalizer.

Each acknowledgment wait is now bounded to ten seconds. There is no automatic
retry and no inference that a timed-out transaction failed to commit. A late
positive response cannot resume execution. Unknown entry/effects state remains
fenced. If early cleanup times out, diagnostics report an unconfirmed result;
the original setup error is preserved when present. Successful and failed
requests remove their timers, and late transport rejections remain observed.

Three timeout cases failed against the original code. The updated five-suite
regression run passed 57 tests, including cleanup, admission and late response
cases. These are transport fault-injection tests, not proof of recovery after a
hard-killed hosted worker. Durable Hack rollout flags remain unchanged/off.
