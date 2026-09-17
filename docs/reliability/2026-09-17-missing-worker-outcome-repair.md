# False disconnection from missing provider visibility

## Live evidence

The completed Brevier conversation had a final assistant message with `finish_reason: stop` and ID `run_06gaq15h8i5gv9ajtalh3ga301`, but its run row was `disconnected / worker_not_found`. The row ended at 1789609450549; its matching final message was saved at 1789609600191. The late finish had filled cost and metrics but could not change the first terminal status.

The `/api/runs/reconcile` route treated a Trigger retrieval 404 as proof of worker termination. That contradicts the durable observation rules: missing visibility can reflect environment routing or retention and cannot prove producer exit. This report does not assert which provider-side cause generated the historical 404.

## Correction

- The route ignores missing/failed observations for termination. Explicit terminal records still require matching user and chat tags.
- The old `closeMissingWorker` mutation remains callable for older bundles, but only reconciles exact persisted final evidence. A reported missing worker alone cannot close the run.
- Reconciliation may repair the narrowly identified legacy status `disconnected / worker_not_found` from its matching final assistant message. Other authoritative terminal states, including cancellation, remain unchanged.
- A late finish uses the same evidence-based repair before filling missing cost/metrics. It does not use the requested status itself as proof.
- Owner, chat, assistant role, message identity, recognized final reason and timestamp are all checked. Partial checkpoints, tool steps, unknown reasons and stale messages cannot repair a run.
- No execution claims, cleanup receipts, commands or billing debits are replayed or released.

## Tests and rollout

Three backend regressions and one route regression failed before the fix. Afterward the focused three suites passed 49 tests. The complete Convex suite passed 67 suites / 1,034 tests. Targeted ESLint and whitespace checks passed.

The serving backend (`elated-poodle-998`, matching public and local frontend configuration) was deployed successfully with typechecking enabled. No main worker restart was needed. The full UI production build succeeded, artifact `.next-ui-release-1789613520870-4ef9d044`.

The owner-scoped persisted-outcome mutation repaired Brevier; a fresh read verified `completed / persisted_outcome / stop`. Its cost and total token values remained unchanged. A bounded audit of this owner's 200 newest runs found two more matching final outcomes, both repaired and re-read as completed. Two other legacy rows lacked the required final evidence and were left unchanged.

Evidence logs:

- `/tmp/rift-missing-worker-red.log`
- `/tmp/rift-missing-worker-route-red.log`
- `/tmp/rift-missing-worker-green.log`
- `/tmp/rift-missing-worker-backend-regression.log`
- `/tmp/rift-missing-worker-backend-deploy.log`
- `/tmp/rift-brevier-run-repaired.json`
- `/tmp/rift-owner-legacy-outcome-audit.json`
- `/tmp/rift-owner-legacy-outcome-repaired.json`

This resolves a verified false-disconnection path. It does not establish universal reliability or repair unknown producer/cleanup state. Physical iPhone acceptance, main worker rollout and the latency target remain separate open work.

The exact new artifact is running at `http://localhost:3069`. The authenticated Runs page was opened and showed all three repaired entries as Completed, including Brevier at 6m 59s and $0.89. Unknown/other failure entries remain visible. Main web and worker processes were not restarted.
