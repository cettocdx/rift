# Cache coverage reporting correction

Cache hit rate now measures cache-read tokens divided by total model input, rather than cache reads divided by cache reads plus cache writes. For example, 100 cache-read tokens out of 10,000 input tokens is 1%, not 100%.

Incomplete per-step receipts invalidate the aggregate ratio. A later input total must not make an earlier missing total appear complete; a missing cache receipt must not silently become a confirmed zero. Resetting a fallback model leg resets this coverage state along with that leg's cache counts.

This changes diagnostic reporting, not provider receipts, price rates or credit deductions. No dollar savings are claimed from this change.

Three deterministic regressions failed before the coverage-state fix, including missing summary cache metadata. Afterwards, the usage tracker and provider observer suites passed: 51 tests in 1.632 seconds (`/tmp/rift-cache-coverage-green.log`). Existing tests cover provider costs, token estimates, fallback and summarization handling. Full commit validation remains required.

The Git recovery/classification batch was committed separately as `11b9eb4`: 802 suites, 8,190 tests and 24 snapshots passed, one test skipped. The gate warned about a test worker requiring forced exit; this is not claimed as clean teardown or proof of production worker reliability.

The subsequent full commit hook was not bypassed and failed: 795 of 802 suites passed, 8,180 tests passed, 13 failed, one skipped (1,374.315 seconds). Failures occurred in Git discovery, BuildParametersSelector, ProjectBotsWorkbench, AddOnCreditsDialog, AppearanceSettingsTab, terminal lifecycle and durable image download tests. The two targeted cost suites remained green; this is not proof of a clean full gate. Evidence: `/tmp/rift-cache-coverage-commit.log`. The cost batch remains staged, not committed.

All seven failing suites passed when run alone after native compilation completed: 66 tests in 10.72 seconds (`/tmp/rift-cost-gate-isolated.log`). No test deadline or assertion was weakened. This supports investigating full-run/environment contention; it does not itself establish the root cause. The full commit gate is retried without launching another native build alongside it.
