# Exit receipt read retry

The completed 20-minute run `run_06ga7v0nriou6qbe51kvrlhp01` reported
`cleanupFailure: {stage: remote_exit, errorName: TimeoutError}` and
`cleanupConfirmed: false`. Command completion is not full lifecycle success.

Investigation found that `prepareJournaledCommand.exited()` performed one
receipt file read with a 1,000 ms request timeout. Start receipt lookup already
retried read failures. Exit lookup did not. An injected transient TimeoutError
reproduced a permanently rejected cleanup even when the next read would return
the correct exited receipt. Both new retry tests failed before the change.

Start and exit now share the existing four-attempt, read-only lookup policy.
No command submission or mutation is retried. JSON parsing and identity/state/
descendant checks remain outside the retry loop. Exhausted retries and mismatched
receipts remain failures; they never authorize claim release.

Verification: five related Jest suites passed, 67 tests, including transient
failure recovery, exhausted reads, identity mismatch after recovery, confirmed
PTY shutdown and receipt reconciliation. Targeted ESLint and diff checks passed.

Limitations: the live metadata identifies the cleanup stage, not its exact
internal stack. The reproduced weak path is fixed, but this does not prove it
was the only cause of the recorded live timeout. A new live run with confirmed
cleanup is still required. No claim was manually released and no desktop/native
package was rebuilt as part of this change.

## Subsequent live verification

Worker `20260915.11`, run `run_06ga8cl4vg934l7c5d521sgv01`: completed a
30-second foreground command while the observer was detached. Exact command
count 1, result count 1, three ordered markers, exit 0, duration 32,592 ms,
no duplicate events. Total observation time 57,657 ms includes detachment.
Fresh provider metadata confirmed cleanup. An independent Convex read matched
the same run and showed claim phase `released`. Evidence is retained in the
adjacent `2026-09-15-exit-retry-live.json` and `...-lifecycle.json` files.

The benchmark now captures bounded cleanup evidence and rejects terminal-soak
success when explicit cleanup confirmation is absent or contradictory. Four
new evidence tests plus eight existing command-evidence tests passed. This
short live pass does not replace the still-required long-run/worker-kill audit.
