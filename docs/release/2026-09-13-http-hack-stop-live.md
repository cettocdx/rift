# HTTP Hack Stop: bounded live verification

Runtime source: `1de645b`, installed RIFT UI Preview backend on localhost:3020,
with its deployed Convex development backend. Durable Hack rollout remains
disabled. The native app opened after the production update without an error
overlay. The following execution checks use the existing authenticated CLI
account against the actual HTTP endpoints, not mocked provider responses.

## Observed execution

An isolated session requested one terminal command that prints a test marker,
waits 120 seconds, and prints a second marker. No target scan, project edit or
external site access was requested. The endpoint returned HTTP200 with the exact
execution header after 9.218 seconds. A `run_terminal_cmd` input event arrived at
22.565 seconds; Stop was sent 3.5 seconds later.

Stop returned HTTP202 twice, with `canceled:false` and the original execution
ID. An abort event arrived, the stream closed, and the next Stop response
returned HTTP200/`canceled:true` after 2.907 seconds from the first Stop request.
The authoritative execution query returned `phase:terminal`, `stopped:true`,
`canceled:true`; both active chat pointers were cleared.

The test records tool invocation and server cleanup acknowledgment. It does not
independently sample the sandbox process table or prove exactly when the Python
process began or exited. Strict PTY exit-receipt behavior is covered separately
by adapter/manager tests, including lost and nonzero exit results.

## Old Stop cannot stop the next request

A new execution in the same chat requested a text-only marker. Once its HTTP200
headers arrived, the previous execution's Stop was repeated. It acknowledged
only the previous ID. The new stream then finished normally, emitted exactly
`RIFT_NEW_EXECUTION_OK`, and used no tools. Its authoritative record returned
`phase:terminal`, `stopped:false`, `canceled:false`, with cleared chat pointers.

Evidence files:

- `/tmp/rift-http-stop-live-result.json`
- `/tmp/rift-http-stop-authoritative.json`
- `/tmp/rift-http-stop-followup-result.json`
- `/tmp/rift-http-stop-followup-authoritative.json`

An earlier test request used an invalid approval-mode value and was rejected
with HTTP400 before admission. Its Stop created a pre-admission tombstone. That
negative check is not counted as a running-task cancellation test.

## Remaining acceptance scope

This is a bounded live API exercise. It does not prove native Stop button timing,
reopen while running, network-loss endurance, producer-crash recovery, physical
mobile behavior, or zero outages. Native GitHub setup was being used while this
check ran, so testing did not replace that window's flow. Durable rollout stays
off until its separate hosted dispatch/Stop checks pass.
