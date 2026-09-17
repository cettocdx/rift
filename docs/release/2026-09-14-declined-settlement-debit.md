# Declined legacy bucket settlement

The final legacy usage debit ignored the limiter's `success: false` response.
An earlier balance peek does not reserve credits: another run can consume them
before the actual debit. In that case the finalizer returned successfully and
could proceed to charge overflow calculated from an unfulfilled bucket debit.

The actual debit result is now checked. A declined result rejects settlement
before any personal or team overflow adjustment. This adds no retries and does
not replay a potentially committed adjustment.

Two regressions (personal and team) first failed because settlement resolved;
both now pass. The focused bucket, finalizer-wiring and owner-pricing suites
passed 76 tests. This is not a durable reconciliation implementation: historical
unsettled usage and partial multi-store adjustments still require that work.

GitHub live check in the same session still returned HTTP 404 for the configured
OAuth client (fingerprint `d4d4419af3`). Native browser authorization also showed
GitHub's Page not found. The previously registered replacement app still needs
owner account verification/client-secret completion; no credential was changed.
