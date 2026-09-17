# Preserve runs when provider lookup is unavailable

## Observed defect

The Build resume route converted a Trigger API 404 into an invented `EXPIRED` state. That allowed it to attempt claim release, clear the stored run mapping and return 204 (nothing to resume). The same assumption in `isRunActive` allowed admission to regard an unavailable old run as inactive. A missing provider record does not establish worker or remote command termination.

This was found while checking the rollout gate: a read-only production inventory contained an unresolved 404 alongside an ownership-matched EXECUTING run. It does not prove that every historical disconnect had this cause.

## Change

- Stored, claimed and tagged run lookup failures preserve the existing run/claim and return uncached HTTP 503 with Retry-After. They do not schedule cleanup or mint a stream token.
- A later successful observation reconnects the same run. The existing client transport retries resume GETs; it does not submit a replacement task or replay commands.
- Admission propagates an unavailable lookup instead of treating it as inactive, including explicit replacement requests. Actual terminal statuses still permit the established cleanup/admission flow.

## Evidence

- Before the fix: four regressions failed, 41 passed (`/tmp/rift-resume-404-red.log`).
- After the fix: 269 tests passed across six suites covering resume, run status, claim admission, transport, automatic recovery and route contracts (`/tmp/rift-resume-404-regression.log`).
- Scoped ESLint passed (`/tmp/rift-resume-404-lint.log`).
- Full TypeScript check exited zero (`/tmp/rift-resume-404-types.log`); `git diff --check` passed.
- The exact previously live handle `run_06gaphjppvr61hjgjf51s5bs01` was re-read this turn and still reported EXECUTING. It was not interrupted.

## Remaining work

These changes are source changes after the artifact served on port 3063. A safe rollout remains outstanding. An unresolved provider lookup needs authoritative reconciliation, not automatic relabeling as completed; this patch preserves work but cannot recover a genuinely deleted provider record. Worker cleanup claims, HTTP execution reconciliation and live long-task acceptance remain separate work.
