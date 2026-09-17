# Claimed worker Stop and delayed start integration

The caller now records exact-generation Stop intent before asking Trigger to
cancel a bound task. A queued Stop also records that intent before releasing its
unbound startup claim. If activation wins the comparison, the route reads only
the same generation and follows its bound task. Replacement generations are not
marked, released or remotely canceled by the older request.

Workers distinguish an authoritative canceled claim from genuine claim loss.
Only exact owner/chat/claim/run evidence, or the private queued claim with its
retained marker, becomes an SDK abort. A failed authority read, foreign or replaced
claim, and an unrelated error remain errors. This avoids displaying expected
Stop as a failed response without hiding genuine failures.

Before the first generative model attempt, Stop attempts to close the trusted
task record and finishes its checkpoint before exact claim release. Completed
checkpoint data remains available unless the existing discard policy applies.
Finalization is single flight and does not invent usage or zero-cost facts.
Checkpoint failures remain unconfirmed; the existing best-effort record API is
reported as attempted, not proven persisted. After model start, the existing
usage-aware model completion path remains responsible for accounting.

All new start reservations use `reserveObserved` with the immutable predecessor
captured before asynchronous liveness checks. There is no fallback to the legacy
reservation API. A fresh execution check runs before sandbox/title/generative
work for every claimed purpose, including temporary runs. Existing moderation
and billing preflight precede this fence; external operations already admitted
cannot be atomically revoked by this database query.

## Verification and rollout

Backend `4536be116011823cc3120f7ca9afab5289d3e4c0` first passed normal
commit checks: 637 suites, 5,980 tests passed, one skipped, 24 snapshots passed,
plus TypeScript and CLI verification. Isolated native predecessor acceptance
passed three scenarios with 58 requests in 6.112 seconds; all three exact
synthetic claims were released and read back. Previous native cancellation
acceptance passed nine scenarios with 130 requests.

That exact clean backend was then deployed only to preview
`dev:elated-poodle-998` at its explicit regional origin, with normal typechecking
and no remote environment changes. Functions became ready at 04:52:59 UTC.
Post-deployment metadata had 311 entries and no removed identifiers. The required
new APIs were verified again immediately before caller integration. Two additive
credit-reservation indexes were created; the keyed credit caller remains off.

V3 caller author verification passed 256 tests; independent review passed 193
focused tests and added two lifecycle interleavings. Root then found the route-only
queued Stop gap and requested V4: its real route-to-handler-to-worker-to-SDK test
was red before the fix and passed afterward. V4 author verification passed 262
tests across 14 suites, full TypeScript and lint. Root reviewed that delta and
merged it with the separately reviewed observed-reservation callers in a clean
isolated checkout. The combined focused matrix passed 147 tests across five
suites. Root TypeScript passed after linking the existing per-package dependencies.

Fresh preview Trigger inventory at 10:30:44 UTC contained zero active tasks.
The worker launch job was unloaded while the verified caller files were applied;
an immediate bootstrap attempt failed, and a subsequent normal bootstrap
succeeded. Worker readiness was verified at version `20260911.18`, with the launch
job running. The web production artifact has not yet been rebuilt in this step.
Live UI/Trigger Stop acceptance remains separate from these SDK/handler tests.

## Evidence

- V4 full caller patch SHA256:
  `7b3e0b0911a94009eafb2298581c8c46819f03a17b33a6489660451217b52c8d`.
- V4 delta SHA256:
  `67034327fbe88957da705a7fd83d20462b61befd476cb8d4d7940047b2fd1cda`.
- Combined integrated patch SHA256:
  `17aaa3fc3fa55f94ad3f5b0b583883414d1df262d91b320641b5e21700adca66`.
- Native predecessor result SHA256:
  `121b66f102646e70d49b6a4ae598e06b8e4f8fd7bfe38189980cdc7fcab61c3d`.
- Main deployment provenance: `/tmp/rift-main-backend-4536be1-result.md`.
- Root focused tests: `/tmp/rift-claim-callers-v4-integration-tests.log`.

No real account top-up, provider invocation, usage reset or billing activation is
part of this implementation validation. Native database concurrency evidence does
not prove forced OCC retries, hard-crash recovery or live provider cancellation.
