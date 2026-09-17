# Claim-generation cancellation

The backend now stores cancellation intent on the current claim generation.
The exact owner/chat/claim/run mutation stamps once and retains active ownership.
Only a genuinely new claim can clear it. Marked generations cannot re-enter
activation or persist a new initial turn. Checkpoint execution observes the
marker even after transient chat cancellation fields are cleared. Ordinary Stop
preserves the last completed checkpoint; explicit discard still removes it.

Direct authenticated chat and temporary-stream cancellation mark the current
owned, mapped claim transactionally, including claims that precede persistence.
These existing APIs mean “stop the current chat”; they cannot identify an older
browser generation that the caller never supplied. Exact-generation protection
is available through the service mutation. Conflicting or duplicate ownership
fails closed, and a stale exact request cannot mark a replacement.

The new execution query checks current active owner/claim/run, absence of the
marker, required chat existence and current mapping. Temporary runs may lack a
chat but cannot bypass an existing conflicting mapping. Active claims do not
expire merely because their startup lease is old.

Backend and caller patches are deliberately separate. At this commit the caller
patch has **not** been integrated: the hot-reloading worker must not reference
new endpoints before its backend deployment is verified. The reviewed caller
patch marks observed Stop/replacement generations before remote cancellation and
adds a fresh query immediately before sandbox/title/generative execution.
Moderation and billing preflight precede that proposed fence. Neither a query nor
the marker can atomically revoke an external operation already admitted; existing
abort signals and checkpoint barriers remain necessary. Legacy unbound runs remain
outside the new claim protection.

Author validation passed 292 tests across ten suites. Root independently ran 90
tests across the new backend, Stop route and claim-helper suites in the full
isolated worktree. Independent review passed 190 focused tests and added four
real-handler cases covering busy ownership after lease age, replacement safety,
conflicting temporary ownership and a zero timestamp marker. Array fixtures do
not establish native transaction races or live Trigger termination.

Backend patch: `7174d2050c11ce70aa0d4234ef1c61bf08a90ebded53c397f2f82e422e039c33`.
Pending caller patch: `2bf562471660c5417b3b088d45db4640899dd2ea83b30769bb59663b58d4c2a8`.
Independent regressions: `75abd826976357f132b6b288043aa8f444274e7f3449f81959e974ddc555e543`.
Review: `/tmp/rift-claim-cancel-independent-review.md`.
Rollout and native test plan: `/tmp/rift-claim-cancellation-review.md`.

## Native backend acceptance

Exact backend `a1d5ea9c24b26cac6f0c93b9955e98304c6ef334` was deployed from
the clean detached checkout `/tmp/rift-claim-cancel-backend-a1d5ea9` only to
`dev:artful-jaguar-288` at its explicit `eu-west-1.convex.cloud` origin.
Normal deployment typechecking and function metadata verification passed.
Nine scenarios passed with 130 requests in 13.206 seconds. All nine synthetic
claims were released and read back; none had unresolved cleanup.

Persistent and temporary repeated Stop requests preserved their first marker.
Both activation-versus-starting-Stop outcomes were observed across the two
scenarios. Released/stale generations could not reopen or poison a replacement.
Missing persistent chats, valid temporary absence and synthetic foreign owners
were distinguished. No real account, provider, Trigger task or payment was used.

Harness SHA256:
`c2bb7899943abcaec2653664e749e971059c687e696a26966569186435afd43a`.
Result `/tmp/rift-claim-cancellation-native-cdea45c5-926c-4d7b-adc9-1933017fd3e0.json`,
SHA256 `be5da7e6f9d75f350bdae2c871e9b83e842ff56afb9340f7dddf4bfd1e56db23`.
This verifies native backend request outcomes, not forced OCC retries, actual
deletion/corruption, authenticated-client cancellation or provider termination.

## Caller rollout hold

Before caller integration, root review identified a presentation/lifecycle gap:
a durable Stop can reach the execution fence before Trigger's abort signal.
The pending helper throws generic claim loss, which the SDK turns into an error
chunk and the worker can record as failed. The caller patch must distinguish an
exact confirmed cancellation and finish it as canceled before SDK error emission.
An unavailable or forbidden authority query must remain an error, not be hidden
as a cancellation. The main backend and caller services have not been switched
as part of this isolated acceptance.

An additional actual-handler audit found an older reservation replay gap:
after claim A is released, B replaces A and B is released, replaying A's original
reservation can install A again. Immediate same-current-generation retries are
rejected; the stronger historical never-reuse property is not established by
the nine native scenarios. This also reproduces before the cancellation change.
Current route starts use fresh private UUIDs and the inspected HTTP client does
not automatically retry mutations, so automatic occurrence in today's caller
has not been demonstrated. An observed-predecessor reservation API is being
prepared separately to fence immutable delayed requests without an unbounded
history table. The legacy reservation endpoint remains outside that guarantee.
