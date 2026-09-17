# Interrupted response recovery

The persisted interrupted-response fallback was not recognized by
`needsWorkReconciliation`. The visible error was recoverable, but Build's
Retry handler could enter the regeneration branch, clear plan state and ask
for the original request again rather than inspect already executed work.

The shared recovery classifier now recognizes the canonical interrupted
response, lost live connection, and failed worker messages. The UI offers
“Inspect and continue”. After cancellation/no-active-run confirmation, Build
uses its existing visible reconciliation request and retains prior work.
Startup timeout, credit rejection and disconnected-computer errors do not
alone establish previous execution and keep their existing paths.

Focused verification: 52 tests passed across classifier, actual retry hook,
and error card tests. The hook tests assert no regenerate call for these
interrupted states. This is not a live long-running provider recovery test.
No user's task was replayed as part of verification.

Follow-up audit: the worker's actual persisted timeout/default failure strings
now share named constants with the recovery classifier. Reloaded errors use
those strings verbatim, so this covers serialization rather than only live
client errors. Partial assistant output no longer hides a current persisted
failure. Active, canceled, loading and client-error guards remain unchanged.
New activation and successful release clear last_run_error under current-run
ownership checks (convex/agentRunClaims.ts), preventing an older worker from
reintroducing a stale banner. Focused suites: 48 recovery/hook/serialization
and 75 interruption/claim lifecycle tests passed.
