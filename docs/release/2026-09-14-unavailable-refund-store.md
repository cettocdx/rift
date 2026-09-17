# Do not acknowledge an unavailable legacy refund store

The legacy token-bucket refund returned successfully when its Redis client was
unavailable. A positive deduction could consequently be marked refunded without
any balance adjustment. It now rejects this unconfirmed adjustment. A zero
refund remains a no-op, and keyed account-credit refunds are unchanged.

The regression first failed because the promise resolved without a Redis write.
After the fix, all 74 tests in the bucket integration, refund tracker and keyed
refund suites passed. No retry was added: partially successful multi-store
refunds still require reconciliation rather than replaying unkeyed adjustments.

This corrects acknowledgment, not recovery of historic missing refunds. It does
not establish a durable settlement ledger for the legacy path.
