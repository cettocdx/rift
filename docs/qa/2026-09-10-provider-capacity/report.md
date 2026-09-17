# Temporary provider capacity misclassified as exhausted balance

The supplied 14:03 recording shows the exhausted-provider-balance message and
no retry action. Worker log run_06g8kvmvd91ccaojj9fqn38a01 contains HTTP 402
with metadata.reason=in_flight_budget_exhausted, Retry-After=120, and explicit
instructions to retry after in-flight requests settle. This is not proof of
zero provider balance. The shared generic 402 / credit-text classifier had
incorrectly classified this temporary condition as permanent exhaustion.

The shared classifier now recognizes in-flight reservation failures before
402/credit matching and categorizes them as temporary rate limiting. The UI
recognizes the original persisted error text, explains temporary capacity,
and retains Retry. Genuine exhaustion remains distinct. Removed the UI claim
that the operator was notified because this component cannot verify delivery.
No automatic task/tool replay, account funding, or billing mutations added.

Regression tests failed first (2 failures), then passed: 24 error/UI tests and
56 agent contracts. Root TypeScript and scoped ESLint passed. Upstream capacity
is external; this fix removes the incorrect permanent diagnosis and blocked
recovery, not the provider's concurrency limit.
