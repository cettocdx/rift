# Funded account blocked by stale usage debt

Read-only inspection of the affected account returned 2,000,000 balance points,
11,404 debt points, and zero remaining included points. The desktop displayed
an account-credit rejection. Both admin grant mutations added balance without
settling debt, while admission rejected any nonzero debt unconditionally.

Admin grants now net existing usage debt against available credits. Legacy
rows are normalized inside the authoritative debit transaction before new
admission. Debt settlement is separate from this request's refundable sources
and new-request spending cap. Partial funding retains the unpaid debt and
continues to reject new work; retry does not settle the same debt twice.

Regression tests reproduced the funded-account rejection before the fix.
Coverage includes funded admission, repeated checks, new-request refund without
refunding old debt, and insufficient partial funding. No model task is replayed
as part of this verification. Stored debt is preserved as an accounting charge;
this change does not independently audit the historical provider invoice.
