# Unfunded legacy overflow remains unresolved

The legacy Redis settlement path previously returned success after a partial
bucket adjustment when remaining actual usage had no eligible overflow source.
The settlement journal could consequently acknowledge an incomplete adjustment.

The finalizer now throws when a positive remainder cannot use enabled extra
usage. It neither charges a disabled source nor retries the bucket adjustment.
The existing journal therefore retains an uncertain outcome for reconciliation.
This is not automated debt collection or recovery of historical adjustments.

Three regression cases (absent configuration, disabled extra usage, and enabled
extra usage without balance or auto reload) failed before the fix by resolving
instead of rejecting. After the fix, all 56 tests in the token-bucket integration
suite passed. `git diff --check` passed. Fault-injection tests emit the existing
expected error logs.

The full commit gate and publication remain pending. Host load averages exceeded
300 during this work; only the focused suite was run in one process. Earlier
atomic worker-cleanup changes remain staged separately. No production release
or new web build was published by this change.
