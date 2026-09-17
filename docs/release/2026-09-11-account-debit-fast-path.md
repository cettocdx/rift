# Account debit fast path

The five diagnostic tasks recorded ledger migration at 0 ms and account-debit
requests at 178–1,452 ms. Those requests all disabled auto-reload. They motivated
removing the Node action wrapper for this specific path; they did not establish
whether network transport, dispatch or internal execution caused each delay.

`deductPlanCreditsWithoutAutoReload` executes the existing balance/reset and
debit handler bodies in one Convex mutation. The original handlers and APIs remain
available. Calls with `allowAutoReload: true` still use the existing action.
Included/purchased allocation, debt, limits, rollover and refund rules are shared,
not reimplemented. Both extracted handler bodies were independently compared with
the baseline and found unchanged.

The client sends one request. A lost response may follow a committed debit, so it
does not retry or fall back to the action. Existing unkeyed debit ambiguity remains
a separate reliability concern. Mutation timing includes Convex client queue wait
and transport; it is not pure database execution time.

## Validation and rollout

The isolated integration ran 124 tests covering routing, old-action/new-mutation
result and stored-state equivalence, allocation, caps, debt, revocation, historical
Max allowance reconciliation, refunds and lost responses. Root and Convex
TypeScript checks and scoped lint passed. The deterministic concurrent-conflict
fixture is not proof of live Convex OCC behavior.

Rollout must publish the new backend mutation before updated callers. Keep the
existing action available for older clients and auto-reload. Live timing results
must be recorded separately after rollout; unit tests do not prove a speedup.

The existing development deployment `elated-poodle-998` was updated first with
Convex typechecking enabled. Its function specification exposed both the new
mutation and old action before the caller patch was applied. Main integration
passed 37 focused tests; the ordinary commit checks passed 625 suites and 5,629
tests, with one existing skipped test and 24 snapshots. Source commit: `5368ce2`.
The immutable web build `.next-ui-release-1789094115958-6e8498b0` succeeded and the
restarted web service returned HTTP 200. This remains a development worker
deployment, not production-worker promotion.

## Twenty real tasks after rollout

All 20 persisted greeting tasks completed with final events and zero duplicate
events on worker `20260911.12`. All used `build-codex`, medium reasoning, the same
746-token system prompt and account credits with auto-reload disabled. No builds,
test suites or source edits ran during sampling. The reference was the previous
20-task snapshot batch. These are sequential batches at different times, not a
randomized comparison; provider and network variation remain uncontrolled.

| Milliseconds               | Previous p50 / p95 | New p50 / p95 |
| -------------------------- | -----------------: | ------------: |
| Billing reservation        |          177 / 420 |     100 / 109 |
| Worker model-request setup |        989 / 1,777 |   915 / 1,375 |
| Admission                  |      1,418 / 1,986 | 1,425 / 2,897 |
| Worker start latency       |      1,182 / 1,826 | 1,193 / 2,204 |
| First text end to end      |      4,934 / 6,517 | 4,995 / 6,813 |

Billing maximum fell from 1,361 to 123 ms in these batches. The overall first-text
median did not improve. One initial chat read took 1,637 ms; worker dispatch and
claim tails also varied. The sub-four-second first-text target remains unmet.
Quantiles use the existing harness's nearest-rank convention.

Local evidence: `/tmp/rift-account-debit-20-20260911.json`, its adjacent `.log`, and
`/tmp/rift-account-debit-comparison.json`. Previous batch:
`/tmp/rift-startup-snapshot-20-20260911.json`.

The next bounded admission candidate is the duplicate owned-chat read: the route
loads a chat, then the claim query reads that same chat again and discards it.
Combining those reads requires retaining reserve CAS, project/owner gates,
post-liveness refresh, atomic persistence and final claim/cancellation checks.
It has only been audited, not implemented or measured.

## UI release verification

Before this billing change, clean source `0bddc06` was built into immutable output
`.next-ui-release-1789093721155-ed17da1d`. Only the web LaunchAgent was restarted.
The Appearance route returned HTTP 200. Reloading `/Applications/RIFT UI Preview.app`
retained the authenticated account and completed greeting conversation without an
error overlay or Active task entry. Screenshot:
`/var/folders/wx/z8k5q55n7p3_xclljxndysv80000gn/T/codex-shot-2026-09-11_05-30-53.png`.
This is a short native reload check, not full desktop or mobile acceptance.
