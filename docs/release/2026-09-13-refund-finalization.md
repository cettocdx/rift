# Share legacy refund outcomes

Concurrent error handlers could previously initiate the same legacy refund
twice. A later failure in free-run cleanup also allowed a successful money
refund to be repeated. Separately, refundUsage ignored false balance-refund
acknowledgments and bucket exceptions, reporting unconfirmed restoration as
success.

Legacy cleanup now shares one promise, including its unsuccessful outcome.
It does not retry unkeyed adjustments after a lost acknowledgment. Both issued
refund legs are joined before returning a failure; a sibling may still commit.
The separate keyed reservation lifecycle retains safe same-key recovery.

Five regression cases failed before the fix and passed afterward. Focused
verification, including keyed lifecycle tests and a pending sibling refund,
passed 133 tests in five suites. This is in-process coordination, not a durable
legacy refund receipt or automatic reconciliation service. An unconfirmed
legacy result remains false and requires reconciliation.
