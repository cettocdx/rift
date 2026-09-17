# Rift full-product audit and initial fixes

Date: 2026-09-07. Audience: product owner. Decision: what actually prevents Rift from feeling polished and operating reliably, and what to fix first.

Scope: live local RIFT UI Preview and localhost:3020, source branch codex/reference-ui-rebuild. Preserve the already approved compact UI, account-menu Settings, direct computer Files picker, neutral composer focus, and gradient effort control. Production deployment and installed release are separate, unverified builds.

Primary sources: live UI/DOM, local source and meaningful existing tests, bounded real development agent runs, official competitor docs/source and published benchmark methodology. Competitors: Codex, Claude Code, Cursor and one open-source harness comparator. As-of date 2026-09-07; source dates and limits remain explicit.

No universal agent-strength score without comparable tasks/models/environments. Separate implemented capabilities, test coverage, observed run success/failure, and unavailable cross-product benchmark evidence. No provider login, purchase, external publication, destructive real-world tool action, or arbitrary scoring.

## Work plan
1. COMPLETE — Discover routes and runtime paths; record baseline UI and harness defects plus competitor evidence.
2. COMPLETE — Follow up on high-impact gaps, reproduce defects, run bounded capability checks, prioritize fixes.
3. COMPLETE — Implement confirmed high-value fixes and verify affected behavior while preserving existing work.
4. COMPLETE — Reconcile the evidence and coverage ledger; produce a Turkish report with sources, measured results, fixed/open items and explicit limitations.
5. COMPLETE — All 8 PDF pages visually inspected, 14 source links validated; initial fix package verified and report prepared for delivery. Final TypeScript, targeted regression/lint and diff checks passed. Full visual/native/dark-theme coverage and comparative live benchmarks remain explicitly outside the completed evidence.

The session has no callable update_plan tool (tool inventory checked). This file tracks the plan instead. Root coordinates live UI and Codex research; independent workers cover runtime audit, competitor sources, and UI code coverage.

6. COMPLETE — Second fix package: atomic per-chat admission, startup cancellation, run-scoped cleanup/lease refresh, stale chat-write fencing, bounded auto-continue conflict recovery, remaining UI interaction fixes. 407 tests across 32 suites plus 9 live development Convex checks passed; TypeScript/lint clean. Native light/dark home, file picker, Agents keyboard tabs, Runs filter and Studio sampled successfully. See [second-pass.md](./second-pass.md) for exact coverage and remaining limits.

Discovery/follow-up: primary competitor sources reconciled; ownership and generic-tool preview-loop defects reproduced. CUA later became available for home, Studio, Plugins and Skills in light theme, confirming tab focus loss. Subsequent auth/network and debugger interruptions prevented full visual/native/dark-theme coverage. Initial deterministic harness baseline: 236 tests in 23 suites. No comparative task-success benchmark yet.

Synthesis: 14 primary-source records; 11 behavior-fix categories plus preview root/cache/import configuration. UI35, loop29, harness129, theme13 checks passed; late Save & test14, Plugins7 and auth9 regressions also passed (overlapping groups are not summed). Final TypeScript and targeted lint are clean. Warm HTTP requests succeed but cold compilation remains slow. No complete visual certification or cross-vendor task benchmark.
