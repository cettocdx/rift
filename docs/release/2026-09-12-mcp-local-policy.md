# Bind MCP localhost permission at loader admission

The lazy MCP loader retained database and credential-vault origin, but evaluated
localhost development permission only when discovery later connected. In a
development process, a later opt-in could therefore expand an earlier loader's
permission. Two offline regressions reproduced this at lazy discovery and across
the first registry await. This was not a demonstrated production bypass.

The loader now captures the boolean before that first await and carries it
through lazy origin and server configuration. Connection requires both captured
eligibility and current development opt-in. Captured false stays false; later
tightening also blocks connection. The field is populated by server code, never
mapped from request JSON. Direct API callers without an admission context retain
the existing current connection-time policy.

Production's localhost prohibition, live `MCP_DISABLED`, registry ownership
checks, pinned DNS, private-address rejection, per-redirect validation and
cross-origin credential stripping are unchanged. Disabling localhost permission
does not retroactively revoke an already established transport; this is an
admission/connection restriction, not a new ongoing revocation mechanism.

Focused verification passed 80 tests across six suites, including seven new
origin-policy cases and existing loader/URL/SSRF tests. The new tests use actual
loader, client and URL policy with database and SDK transport boundaries mocked.
No remote MCP server was contacted. Full combined release checks are recorded
in the external evidence report. Worker reuse remains disabled pending an
isolated deployment canary and the rest of production acceptance.
