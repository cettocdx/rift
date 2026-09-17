# Hack Workbench cutoff presentation — 13 September 2026

## Exact observed failure

Installed Preview at `f4622d7` showed a checked Response section for saved chat `5b6a2a1d-8919-46a0-811b-050beff0a6cd`. Its text described future verification/reporting rather than a finished assessment. The app also showed Ready and an available work log.

Read-only Convex inspection confirmed chat `finish_reason: timeout`. Run `c6e2c24d-f85a-46b6-a544-f9bcea061741` had the same reason and status `completed_with_warnings`. The earlier greeting run had `finish_reason: stop` and status `completed`. No saved security commands or scans were executed during this investigation.

## Cause and correction

The transcript's trailing-text extraction located a possible answer after the last tool. Its renderer considered a settled, non-cancelled turn completed without consulting its persisted finish reason. The client message query also omitted the message's existing finish_reason field, so a later turn could erase evidence of an earlier cutoff from the UI.

The query now exposes that optional field and conversion preserves it as message metadata. Cutoff messages retain their readable content under Partial response, show the recorded stopping reason, and omit the completion check and final-report action slot. Time limits, context limits, exhausted usage budget, repeated-action cutoff, and unknown explicit outcomes are covered. Missing legacy outcomes retain compatibility; content alone is not used to guess why a run stopped.

This is a truthfulness and recovery-presentation fix. It does not remove execution time limits, refund usage, finish the interrupted assessment, or prove long-task reliability. The top-level evidence report remains accessible. There is no schema migration or history rewrite.

## Verification scope

Regressions were run before implementation against the actual HackerMode and transcript components, message query, and message conversion. Seventeen initial failures demonstrated missing cutoff classification/history projection; unknown-outcome follow-up cases also failed before their implementation. Tests cover preserving an earlier cutoff beside a later successful answer, active producers, and explicit per-message success overriding stale chat state.

After deployment of `11a4346`, the installed app showed the exact recorded timeout as Partial response with the time-limit explanation and no completion check. Its earlier successful greeting still appeared as Final response. This confirms the saved-session presentation change without re-executing the assessment.

That native check exposed a remaining screen-reader status mismatch: the visually corrected turn still announced Assessment response ready. The follow-up change uses the same latest-turn outcome for the live status region, covering partial, interrupted, missing-final, and successful outcomes. Older cutoffs do not change a later successful announcement. Regression-first verification covered this separately before integration.
