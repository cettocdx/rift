# Preserve uncertain balance settlement outcomes

The PAYG final adjustment previously ignored `success: false` returned by the
balance debit/refund helpers and swallowed thrown transport failures. A caller
could therefore treat an unconfirmed adjustment as successfully settled.

`deductBalanceUsage` now rejects for an unsuccessful debit or refund and
propagates thrown failures. It still makes only one adjustment attempt. This is
important because an absent acknowledgment does not prove the adjustment did
not commit. The web and long-run finalizers retain their single settlement
promise, including rejection; they must not replay an unkeyed adjustment.

Three regression cases failed before the fix and pass after it: unsuccessful
debit, unsuccessful refund and lost transport acknowledgment. The related
token-bucket and finalizer suites passed 74 tests.

This change exposes uncertainty accurately. It does not reconcile or replay
legacy balance adjustments, nor guarantee that every UI surface presents that
uncertainty correctly. Atomic keyed settlement remains necessary for safe
automatic recovery.
