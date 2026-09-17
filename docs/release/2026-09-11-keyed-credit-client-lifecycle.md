# Keyed account-credit client lifecycle

The server-only lifecycle captures a trusted operation identity, authenticated
owner/tier, original amount, Convex client and service authority before awaiting
reservation. Chat/console identities are server UUIDs; worker identity comes
from its accepted Trigger run. Request-body reservation identities are not used.

Reserve and pre-use close recover at most once using the same key. First use is
attempted once and only an acknowledged newly granted result permits dispatch.
Cancellation suppresses late continuations. A lost first-use response remains
unknown; a confirmed closed tombstone remains closed, including when its reply
arrives after cancellation. Contradictory closed/granted replies cannot establish
restoration.

Terminal observations are copied into one private, immutable, owner-bound
snapshot. A failed settlement acknowledgement retries that exact snapshot.
Concurrent settlement calls share one request; a durable acknowledgement is
latched independently of analytics. Unknown post-dispatch usage is not zero.
This version retains existing pricing and never dispatches an auto-payment or
unkeyed fallback adjustment.

`UsageRefundTracker.trackKeyedReservation` attaches this lifecycle before any
potentially charging await. Attachment verifies the same owner/tier and excludes
organization, free-claim and previously recorded legacy charges. An undelivered
reserve receipt is still a pending obligation, rather than an empty tracker.
Cleanup routes exclusively through keyed close, reports unresolved responses
truthfully and preserves already settled terminal charges. Existing callers
without an attachment retain their previous behavior.

Independent review caught and corrected an initial owner-binding gap and a
confirmed-close race before caller activation. Adapter and actual backend-handler
tests exercise committed-response loss, source restoration, immutable retries,
cross-owner rejection and cancellation. Storage in these client tests is
simulated; native backend concurrency is documented separately in the reservation
and terminal settlement reports.

This client slice alone does not fix the current three request paths. Their
migration must attach before charging, fence before model/tool/sandbox work,
provide trustworthy final observations and exclude legacy refund/true-up for
keyed charges. Current entitlement, suspension, debt and worker claim checks
must be enforced at production admission. Initial console migration remains
default-off until that stronger admission path is deployed and validated.
Process-crash usage recovery and ordinary QA authentication are separate gates.
