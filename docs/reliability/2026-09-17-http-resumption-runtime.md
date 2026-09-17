# HTTP resumption runtime — 2026-09-17

## Root cause and corrections

The local release environment had no Redis/KV connection configured. `getStreamContext()` therefore returned null: the producer could finish and save its answer, but a detached reader could not reattach live. This is separate from Build's durable worker transport.

The first isolated test started one harmless print/sleep/print command, detached the reader, and received pending responses during reconnect. Authoritative persisted output later showed exit 0, both markers, and a final assistant message. A completed-turn GET nevertheless returned empty HTTP 204. The task had completed; observation/replay had failed.

The stream route now permits owner-checked persisted answer replay when no producer is active and Redis is unavailable. An exact active execution still returns marked pending, and an ambiguous legacy active stream is not replayed as completed. Persisted SSE response bodies are encoded as bytes, fixing the separately reproduced non-Uint8Array response-body error.

The local runtime now uses an authenticated Redis service bound to loopback port 6389, maintained by the user's `app.riftsys.stream-redis` LaunchAgent. Its private configuration and credentials are outside the repository; `.env.local` contains the connection URL. No credential is recorded here. This provisions only this Mac, not a production Redis service.

## Verification

- Six focused suites: 121 tests passed. Log: `/tmp/rift-resumption-config-tests-0917.log`.
- Scoped lint and whitespace checks passed.
- Production build passed, including TypeScript. Log: `/tmp/rift-resumption-build-0917.log`.
- Isolated preview 3057 uses `.next-ui-release-1789600861808-5c3bc7f1` and the new Redis environment.
- Live chat `f35ac062-d089-47e9-934e-ce2b1d108da1`, execution `a0066bfc-bdf5-4afc-ae75-6dc915e49dd7`.
- Original reader detached at 13,108 ms after the one command started. After a five-second absence, GET returned HTTP 200 with the same execution ID.
- One unique terminal command, one finish, zero stream errors; both `RIFT_RECONNECT_START` and `RIFT_RECONNECT_DONE` observed, exit 0. End-to-end observation: 60,056 ms, including the intentional 35-second sleep. This is not a startup latency benchmark.
- Evidence: `/tmp/rift-hack-detach-result-0917.json`, `/tmp/rift-hack-detach-with-redis-0917.log`.

## Rollout limits

The main 3020 process still uses its previous environment and release. Its read-only maintenance gate could not establish restart safety: one HTTP execution remains marked running, and retrieval of a historical Trigger run returned 404. No producer was killed and no historical claim was forcibly released. A 404 is not proof of cleanup or safe restart.

The live result verifies reader disconnection/reconnection while the producer survives. It does not verify native-origin process death, server replacement, multi-hour execution, or production durable Hack migration. macOS screen/input permission readiness and the other release requirements remain independent.
