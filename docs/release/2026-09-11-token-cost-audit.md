# Token consumption and cost accounting audit

Baseline: `f3f2f1b1a47f333da664056d80a0cdb1ab6d1f96`.

## Findings

- Routine persistent-terminal results included the cumulative cleaned session snapshot, even on an empty poll. An offline fixture using the actual xterm formatter and tool projection produced approximately 98,000 input tokens from a 148 KB retained snapshot. This establishes an amplification path, not the exact contents of any user's past request.
- AI SDK 6 `onFinish.usage` contains the final step. RIFT persisted/logged that alongside whole-run cache counters. This understated multi-step input/output/cost and could make cache counts exceed logged input. Completed-step aggregation now uses one scope, including abort/error cases where SDK `totalUsage` is empty. It does not re-accumulate billing usage.
- The logger applied a hardcoded universal token price when provider cost was absent or zero, and reading the event twice could add tool costs twice. It now preserves explicit zero, reads current SDK cache/reasoning fields, omits unknown total prices, and recomputes known totals from source values.
- Billing treated explicit provider `raw.cost: 0` as missing. The correction distinguishes zero from missing/invalid cost through tracking, reconciliation and console settlement. A regression verifies refunding the prepaid estimate for a zero-priced response.
- Cost estimates used retail dollars while provider-reported costs used raw dollars. New estimates use raw model dollars; settlement retains the same price table, 10,000 credits per retail dollar, existing rounding and 2.5 retail margin.
- Paid budget monitoring compared raw dollars with retail credits. It now converts to the same retail points used by settlement. Free allowance accounting and operator raw-dollar caps keep their existing semantics; balance-derived caps convert retail funds to raw dollars first.

## Terminal correction and measured scope

Routine live PTY polls now project their capped unread delta and the actual current terminal screen. Oversized retained scrollback is saved to a content-addressed file using the existing sandbox output saver before it is omitted from the model projection. Unchanged polls reuse a successful file receipt. A failed or timed-out save preserves the original inline evidence. Raw terminal data and the full cleaned snapshot remain available to the UI/persistence; an explicit `view` still reads full retained scrollback. Rejected or raced failed sends leave unread bytes for the next poll.

The same 148 KB fixture measured 98,013 estimated model tokens before and 1,499 after for both live tool projections. Five unchanged polls wrote one file, with exact text readback. This is a fixture-specific 98.5% reduction, not an account-wide cost saving or latency claim. Local double-xterm formatting across ten samples measured median 8.73 ms and maximum 33.07 ms.

Historical messages deliberately retain full cleaned scrollback: a sandbox-local file can expire, so a historical receipt alone is insufficient to discard persisted evidence. Historical context reduction needs verified re-staging or durable artifacts and is not solved by this batch. Existing ring-buffer eviction and sandbox lifetime still apply. SSE producer backpressure is a separate unresolved transport issue.

## Accounting evidence limits

The worker's historical `rate_limit.points_deducted` and `extra_usage_points_deducted` fields describe admission estimates, not final net charges. Historical wide-event usage could describe only the last step. These logs alone cannot prove or disprove a duplicate debit. No historical credit correction or pricing-policy change was made by this batch.

Cache and reasoning are subcounts, not additional billed token totals. Repeated cumulative SSE usage frames are replaced by the installed provider; the SDK emits one completed-step usage record. Offline installed-SDK tests cover both properties.

Remaining accounting work includes ambiguous lost-response recovery in the unkeyed worker billing path; mixed priced/unpriced step coverage; source-aware repair of historical forecast units; and the conservative prepaid-estimate overlap in monthly budget monitoring. Provider costs absent from a response still require estimates. Do not label this batch as complete billing reconciliation or production certification.

All audit fixtures and model streams in this batch run offline. Account balance was read without mutation; no model request, credit top-up or usage-reset redemption was performed for the investigation.

## Validation

Combined focused validation: 303 tests across 16 suites passed; full TypeScript check passed. The installed-provider offline harness passed both tests. Independent reviews covered explicit zero/units and completed-step accounting, including multi-step abort/error regressions, and terminal failed-send/history preservation. The token fixture was independently rerun with the same 98,013 → 1,499 result and exact saved-text readback. Full repository/release-build results are recorded separately during integration.
