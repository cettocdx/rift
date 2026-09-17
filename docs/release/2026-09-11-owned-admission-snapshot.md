# Owned admission snapshot

The route loaded a chat before project validation. Claim acquisition then queried
the claim through `readOwned`, which fetched the same chat again and discarded it.
For fresh persisted admission this added a serial RPC to the critical path.

An additive backend query now returns the existing sanitized chat and claim
projections together. A request-local server-only capability binds the result to
the authenticated user and chat. Request JSON cannot supply that capability.
Acquisition reuses the claim observation only when the persisted chat has no
active mapping and the claim is absent or released.

The reservation transaction still checks current ownership, claim and mapping.
Active and temporary paths retain live reads; remote liveness checks still cause
a chat refresh. Project and suspension checks, atomic initial-turn persistence,
existing-chat deletion protection and final cancellation checks remain in place.

Independent review found no blockers. The new regressions failed before the
implementation; 179 focused tests passed afterward, along with TypeScript and
scoped lint. Cases include competing claims/mappings after snapshot creation,
foreign and duplicate rows, deletion before persistence, forged capabilities,
active/temporary fallbacks and cancellation after persistence. Database fixtures
run real handlers over in-memory rows; they do not prove live Convex OCC behavior.

The existing `elated-poodle-998` development deployment was updated with Convex
typechecking enabled before installing the route caller. Function metadata
confirmed both `getAdmissionSnapshot` and the old `getForBackend` endpoint.
No compatibility fallback bypasses ownership checks.

The expected saving is one RPC on eligible fresh admissions. Live measurements
are required before claiming a latency improvement; the overall four-second
first-response goal remains unproven.
