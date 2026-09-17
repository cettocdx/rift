# Live Build subscriber reconnection

Local production Preview on localhost:3020, source `93cfa29`, dispatched an
isolated authenticated Build request to the real development worker. The test
requested exactly one Python terminal command: print a start marker, sleep 60
seconds, print a done marker. It requested no project edits or external access.

Admission returned HTTP 200 at 2.298 seconds. The terminal input event arrived at
8.973 seconds. The observer aborted its stream and waited three seconds before
calling the authenticated resume endpoint. Resume returned HTTP 200 at 13.507
seconds with the same run ID. The observer continued from its last event ID.

The finish arrived at 77.466 seconds. A separate reader then inspected the whole
durable stream and authoritative run, rather than trusting the resumed view:

- Trigger status was COMPLETED; finish reason was stop.
- Exactly one run_terminal_cmd invocation contained the requested sleep.
- Its output contained both start and done markers.
- The final assistant response contained the completion marker.
- Two distinct main-model receipts were present in the persistent usage journal.

Run: `run_06g9n658iqstbvoqc897ipl601`.
Chat: `d9c8831e-429d-485d-9941-6c0b646a34b7`.
Evidence: `/tmp/rift-build-reconnect-live-result.json`,
`/tmp/rift-build-reconnect-proof.json`, `/tmp/rift-build-reconnect-usage.json`.

This verifies deliberate subscriber loss through actual API/SDK connections.
It does not prove native window relaunch, physical network loss, hours-long
execution, worker process death, or exactly-once recovery after producer death.
The test harness's remaining SDK socket was terminated only after completion
and independent verification; no worker or user application was killed.
