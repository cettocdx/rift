# Billing reservation timing — 2026-09-11

## Instrumentation and invariants

The existing worker setup metadata now separates `billingMigration` from `billingAccountDebit`, nested inside `billingReserve`. Migration finishes before the debit options are read and the single debit call begins, as before. The optional observer preserves other callers and cannot veto a debit or replace its error, including synchronous throws and rejected asynchronous sinks.

`billingAccountDebit` measures the whole Convex action request and result mapping, including transport and any internal query/mutation or auto-reload work. It is not pure database execution time. Timings include failed attempts. `billingReservation` contains only a bounded routing strategy and, for the account path, the actual `autoReloadAllowed` option. It does not assert a successful charge or an actual reload.

The startup benchmark retains only these allowlisted context fields. No account identifiers, balances, payment details or arbitrary metadata are copied. Existing run identifiers provide correlation without introducing another log stream.

Reviewed patch SHA256: `03bc3a3a3726ba5e19d08ea119bc6d4a7a4d7de096a027f4f33537057573d502`. Isolated validation: 159 tests, root/Convex TypeScript and ESLint passed. Integrated directly affected suites: 24 tests passed; benchmark syntax check passed. No Convex schema or API deployment is needed for this instrumentation.

## Actual diagnostic run

Five persisted greeting tasks completed on worker `20260911.11`, all with finish events and no duplicate events. Report: `/tmp/rift-billing-diagnostic-5-20260911.json`; log: `/tmp/rift-billing-diagnostic-5-20260911.log`. Heavy builds and tests were not running during sampling.

| Sample | Migration | Account debit | Whole reservation | Strategy        | Auto-reload allowed |
| ------ | --------: | ------------: | ----------------: | --------------- | ------------------- |
| 1      |      0 ms |      1,452 ms |          1,452 ms | account_credits | false               |
| 2      |      0 ms |        529 ms |            530 ms | account_credits | false               |
| 3      |      0 ms |        221 ms |            223 ms | account_credits | false               |
| 4      |      0 ms |        178 ms |            180 ms | account_credits | false               |
| 5      |      0 ms |        312 ms |            312 ms | account_credits | false               |

This isolates the observed billing delay to the debit action/transport, not ledger migration, for these five requests. A cold action remains a hypothesis: these timings do not separate network/dispatch from the action's internal work. All five requests qualify for investigating a non-auto-reload atomic debit path. That optimization must preserve allocation, caps, revocation, rollover, refunds and current claim/cancellation admission before rollout.

First-text p50 was 5,636 ms in this small diagnostic batch. It is not a matched end-to-end improvement result or a replacement for the preceding 20-run acceptance comparison. The sub-4-second target remains open.
