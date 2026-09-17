# Mobile composer and fallback cost corrections

## Long drafts keep actions reachable

The mobile toolbar uses two rows of touch controls. A 200px autosizing textarea plus those rows exceeded the composer's 286px cap, and an active goal made the clipping worse. The textarea wrapper could not shrink; the overflow-hidden shell hid Send/Stop.

`ComposerSurface` extracts the unchanged production shell/frame so the browser fixture uses the same cap and layout, alongside the actual `ChatInputTextarea`, goal and toolbar. File-upload/network services are isolated; this fixture does not submit real tasks. Previously the fixture used a plain short textarea and omitted the height cap, so passing toolbar tests did not cover this defect.

The textarea wrapper now allows flex shrinking, while the toolbar and goal reserve their height. Long text scrolls within the remaining area. Four Chromium coarse-pointer cases failed on clipped actions before the correction, then passed. The expanded matrix passes 70 cases across Chromium/WebKit, widths 360/390/430/1200, fine/coarse pointers, long drafts with/without goals, Send/Stop, and a 480px reduced viewport. Tests verify hit-testing, no overlap, retained text, textarea scrolling, and button handlers. This is not a physical iOS keyboard or authenticated end-to-end task test.

Eleven focused component suites (115 tests) pass, including actual ChatInput integration. Full release checks are recorded separately.

## Attribute estimates to the model that executed

Provider receipts remain authoritative, including explicit zero. Previously operations without receipts were estimated at the final caller's selected model, even after RIFT explicitly switched to a different fallback model. Accepted summaries could also inherit the wrong estimate.

The shared stream runner passes the active model key with observed usage and accepted summaries. UsageTracker groups unpriced tokens by that key, adds priced receipts unchanged, and uses the legacy caller fallback only where attribution is absent. Grouped counters avoid storing every step. Existing failed-leg waiver and settlement/margin policies are unchanged; no historical account adjustments occur.

Real AI SDK regressions fail before forwarding model attribution: a fallback cost estimates $0.011 instead of $0.0033, and a summary estimates $0.065 instead of $0.0195. Eight focused suites (116 tests) pass after the correction, including receipt-zero, mixed costs, repeated resets, retained summaries, legacy callers and settlement.

Missing receipts remain estimates. A provider's own hidden routing/fallback cannot be priced exactly without served-model or cost evidence. Full auxiliary-operation ledger coverage remains open.

## Overlap integration reads without moving execution gates

Worker admission, entitlement preparation and free-run locking still finish first. Owner-scoped lazy MCP registry and GitHub database reads now start alongside tracked preflight, instead of waiting for moderation to finish before starting. MCP discovery retains its profile allowlist, lazy mode and greeting behavior. No transport connection or tool execution starts during this preparation.

The helper owns late results: cancellation rejects readiness immediately even if a database read hangs; an MCP result arriving later closes once. Reservation/refund and moderation gates still complete before a model can use integrations. Six focused suites (84 tests) pass after red/green cancellation and ordering regressions. Based on the preceding single sample, this overlaps approximately 138ms of reads; live latency improvement has not yet been measured.
