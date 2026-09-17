# Long-run continuity verification — 2026-09-10

Source: reference-ui checkout. Fault injection used an isolated runner and its own WebSocket proxy; the user's managed runner and network were not interrupted.

## Findings and fix

The Local runner published stdout/stderr/exit independently and discarded failed publications. A 15-second relay outage lost 40 of 60 numbered lines despite exit 0 and a single command execution.

Command output now uses an ordered in-memory delivery queue, retaining a stable delivery ID across retries. The command consumer ignores repeated delivery IDs. Exit is queued after output. Buffer limit is 32 MiB; delivery retry deadline is 120 seconds per head item. Exceeding these bounds fails delivery rather than reporting a successful exit. This is transient delivery protection, not persistent execution.

After rebuilding the Local package, the same isolated test delivered 60/60 lines, zero missing, zero duplicate, exit 0, and one execution. See before/after JSON evidence.

A Cloud persisted 60 × 10-second continuity task completed in 675,240 ms (including startup), with observer detached, final marker confirmed and zero duplicate event IDs. Run: run_06g8mao6fg8gbse36tp5g6oi01, worker 20260910.15. This verifies API observer detachment, not actual desktop navigation. The probe did not independently count all 60 Cloud markers or command executions.

## Remaining boundaries

Runner termination/restart re-registers, but does not resume the original shell process. Restart probe execution count remained one. It must not automatically replay potentially mutating commands. Durable process ownership and recovery remain outstanding.

The user's already-running managed runner was not restarted to load this change; the fix was verified in the rebuilt isolated runner. No production web rebuild/deployment was performed in this pass. Web consumer deduplication requires the updated server to be loaded.

Observer-side disconnection, machine sleep, prolonged outage, buffer overflow UX, and full desktop navigation remain separate verification cases. Do not describe this as eliminating all disconnections.

Regression checks: ordered retry delivery, stable retry identity, stopped queue rejection, overflow failure, and consumer duplicate suppression. Local TypeScript build and root TypeScript check passed.

## Follow-up: managed launcher restart recovery

Managed POSIX command execution now runs in a detached Node worker with its own authenticated relay subscription, output delivery, timeout and cancellation handling. It survives launcher termination; it does not recreate the shell. The managed launcher persists its relay identity and refreshes that identity on restart. A persistent command claim prevents starting the same command ID twice. Standalone non-managed runner and Windows execution are unchanged.

Fresh verification after implementation:
- 51 tests across six suites passed; Local build, root typecheck and targeted lint passed.
- Isolated 15-second outage: 60/60 lines, zero missing, zero duplicates, execution count one.
- SIGKILL of the launcher followed by restart: same connection ID, original command finished with exit 0, execution count one.
- Subsequent command on the same connection succeeded.
- Cancellation after restart returned 130 and did not run the trailing completion marker.
- See restart-kill-results.json for recorded evidence.

The earlier statement that launcher restart cannot preserve commands is superseded for managed POSIX execution. This is not recovery from machine reboot, death of the independent command worker, or an arbitrarily long network outage. Those failures cannot resume an arbitrary shell safely by replaying its command. Relay identity reuse also requires the existing backend connection still to be active.

The installed LaunchAgent was observed running the managed implementation with a persisted connection identity after host restart. The live-managed.json probe verifies a command through that actual runner. No blanket application stability or UI navigation equivalence is claimed.
