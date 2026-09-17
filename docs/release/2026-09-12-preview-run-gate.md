# Preview maintenance run inventory

Use `node scripts/preview-run-gate.cjs` immediately before considering preview
maintenance. It is read-only. Exit 0 means a complete, valid snapshot has no
unreleased claims. Exit 2 means unreleased claims require authoritative run-state
verification and application reconciliation. Exit 1 means the inventory could
not be validated. Neither failure permits restart. This is an observation, not
an atomic maintenance lock; new starts can race a later restart.

## Evidence correction

Earlier ad-hoc checks used `row.status` for `agent_run_claims`. That table uses
`phase`. Their reported zero active counts are not valid evidence and must not
be used to justify future maintenance.

Corrected inspection found 267 rows: 266 released, one active. A read-only Trigger
lookup of its bound run returned `FAILED` for task `agent-long`. Therefore that
record is stale, rather than evidence of a currently executing worker. No claim
was deleted/released, and no process was restarted during this correction.

The reusable gate validates schema, complete bounded inventory, unique chat
claims and actual phase values. Missing phase, status-only rows, unknown values,
truncated pages and malformed rows fail closed. Expired leases or cancellation
requests do not establish task completion. The four Node tests cover these cases.

A subsequent admission/recovery flow must reconcile stale claims through existing
ownership/CAS checks. This script intentionally does not mutate them, and never
turns a failed lookup or elapsed time into permission to restart.
