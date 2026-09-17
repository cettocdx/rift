# Background process observation and file readiness

Inspection of hard-worker-death recovery prerequisites found that the existing
in-memory BackgroundProcessTracker deleted a process whenever `ps` failed.
A network error therefore became a false "not running" result and could make
partially written output appear ready. Matching a PID by substring also accepted
other process IDs.

The tracker now accepts only exact `ps -p PID -o pid=` output with exit zero as
presence, or empty stdout/stderr with an explicit exit-one receipt as absence.
E2B's CommandExitError carries the latter receipt. Unknown/failed observation
throws and preserves the tracked entry; callers cannot interpret it as idle.
Invalid PIDs are rejected before submitting a command.

File readiness now probes only producers matching the requested file, using
whole path components. Unrelated offline work and similarly suffixed filenames
cannot block a separate download.

Regression tests first reproduced the old loss of tracking and unrelated-file
failure. Focused verification covers lost transport, nonzero diagnostics,
missing/malformed results, exact PID identity, SDK exit-one receipts, invalid
PIDs and unrelated file paths.

Limit: this tracker remains in-memory and PID presence is not a durable process
ownership proof. It must not be used to kill a possibly reused PID after worker
restart. Hard-death recovery still requires durable run/resource identity,
fencing late starts on the remote host, and an independent reconciler. This fix
removes a false absence assumption; it does not implement that reconciler.
