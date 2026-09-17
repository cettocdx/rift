# Remaining worker reuse review

Read-only source review after namespace-origin binding. These are regression
candidates, not executed reproductions or evidence of a production incident.
Process reuse remains **off**.

Update: the first three candidates below were subsequently reproduced and fixed.
See [pending terminal creation and tool receipt isolation](2026-09-12-tool-lifecycle-isolation.md)
for the regression boundaries and remaining limitations. The original review
below is retained as the pre-fix investigation record. MCP policy review and the
deployment-isolated canary remain open.

Subsequent update: item 4's admission/connection policy is now also reproduced
and fixed; see [MCP localhost policy](2026-09-12-mcp-local-policy.md). The isolated
deployment canary remains required. Historical candidate wording below records
the original review rather than an assertion that those fixes are still absent.

1. `lib/ai/tools/verify-app.ts` keeps screenshot results in a module-global cache
   keyed only by tool-call ID. Empty screenshot results do not overwrite an old
   entry; `toModelOutput` consumes by that same ID. A bounded regression should
   leave A's frames unconsumed, then invoke B with the same ID and a failed/empty
   verification. B must never receive A's frames. Prefer tool-instance/run ownership.
2. `lib/ai/tools/utils/pty-session-manager.ts` registers a PTY after awaiting its
   creation. `closeAll` sees only registered sessions. A deferred handle arriving
   after cleanup can then be registered and receive input in `run-terminal-cmd.ts`
   before its output wait observes cancellation. Reproduce pending creation,
   cleanup, then resolution: require orphan termination, no input/registration,
   and no effect on another run's sessions.
3. `lib/ai/tools/utils/sandbox-file-uploader.ts` still checks the current public
   Convex URL. Scoped database authority remains bound, but a later missing URL
   could reject a valid originating upload. Cover the configuration gate as well
   as the database call before removing this prerequisite.
4. `lib/ai/mcp/mcp-client.ts` reads local-development permission at transport
   connection. Decide explicitly whether this is captured run policy or an
   immediate global restriction, retaining SSRF protections in either case.

Follow-up source review of item 4: lazy discovery captures database/vault
authority but not local-development eligibility. A development process changing
that setting before discovery can expand the earlier run's permission. The
current transport snapshots it on connection; it is not immediate revocation.
Production remains denied unless the process also changes to development mode.
This is a conditional regression candidate, not a demonstrated production
bypass. The next bounded change should require admission eligibility AND current
connection eligibility, retaining the deliberately live `MCP_DISABLED` switch.
Test both permission-change directions and independent runs without weakening
DNS pinning, redirect validation, private-address rejection or header stripping.

The task cleanup map already keys by run ID, restores captured authority and
rechecks cleanup identity after awaiting completion. PTY run keys also isolate
registered sessions. Neither fact closes the pending-creation race above.
Operational flags and diagnostic environment reads alone are not credential
leaks. Caido's token cache is currently outside the active worker configuration.

Enabling process reuse requires resolving and testing these lifecycle boundaries
and a deployment-isolated canary. Existing preview/production data and billing
bindings must not be repurposed as isolation test accounts.
