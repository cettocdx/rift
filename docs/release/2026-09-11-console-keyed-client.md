# Console keyed credit lifecycle

The console route now has an inactive, server-controlled Pro/Ultra path using
production-bound reservations. Its UUID and owner binding exist before migration
or reservation awaits. Current account authorization occurs at first use; only a
newly granted response permits the provider request. Organization, free, team and
effective auto-reload requests retain their existing billing path.

Successful SDK completion with explicitly reported token counters produces one
immutable terminal usage snapshot. A lost settlement acknowledgement receives at
most one identical retry before completion and local tool proposals are released.
This recovery does not repeat the model request. Missing completion, unknown
usage, cancellation, debt or unresolved acknowledgement withhold proposals.
Analytics transport cannot invalidate an acknowledged accounting result.

Root verification passed 219 tests across seven suites, including actual adapter
and backend-handler cases. Independent review added final SDK response rejection,
cancellation during the second settlement acknowledgement, late usage callbacks
and indefinitely pending analytics. Array-storage fixtures and mocked provider
boundaries do not establish deployed authentication, native transaction isolation
or provider-side exactly-once billing.

`RIFT_CONSOLE_KEYED_CREDITS_ENABLED` remains off. Backend-first isolated acceptance,
operational handling of unresolved reservations and authenticated end-to-end
verification are still required before activation. A new HTTP request has a new
UUID; process-crash reconciliation and cross-request deduplication are not supplied
by this in-request retry. Worker and HTTP chat migration remain separate work.

Reviewed source patches:

- Adapter: `514f4f8e989d6647709bd112097f77942c706636a8fd6e2c00a6f12d3d9b99d9`.
- Console: `63c93edfea65de193408ef3f85894e6d2c200ede4a61c51f42e1d2fd7bc96a60`.

Independent review: `/tmp/rift-console-client-independent-review.md`.
Root focused log: `/tmp/rift-console-root-matrix.log`.
