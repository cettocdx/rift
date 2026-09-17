# Browser MCP readiness and truthful tool outcomes

## Observed failure

The completed Brevier conversation (`c5912f7c-2cf5-462f-842d-ca2afaf08ce1`) persisted a `dynamic-tool` invocation named `mcp_browserbase_start` with `output-available` and the string `Tool error: MCP tool call failed (Error).` This was a real user task; it was inspected without replaying its commands or changing its project.

The owner-scoped connector record pointed to `https://mcp.browserbase.com/mcp`, had no headers, encrypted credentials, or OAuth credentials, yet was marked verified with six discovered tools. Public tool discovery had been mistaken for executable readiness. Browserbase's [official setup documentation](https://docs.browserbase.com/integrations/mcp/setup) requires a Browserbase API key for the hosted MCP browser tools.

## Correction

- Reject the exact known hosted Browserbase endpoint when credentials are demonstrably absent, before opening the MCP connection. Leave other public or self-hosted endpoints unaffected. Supplied credential candidates still require normal transport validation; their presence is not proof of validity.
- Return a safe `credentials_required` response from connect, probe, and recheck. Mark the owner's existing connector as needing attention rather than repeatedly presenting its tools as usable.
- Filter this missing-credential configuration from the backend runtime list too. This protects existing workers without restarting active user tasks. The connector record is retained for configuration in Plugins.
- Preserve MCP `isError: true` when normalizing text-only results. A remote transport exception returns an explicit unconfirmed result with `retrySafe: false`; it does not cause blind replay of a potentially executed action or expose a remote exception's credentials.
- The transcript distinguishes explicit MCP errors from unconfirmed transport outcomes. Arbitrary file contents containing error-like text are not treated as tool failures.

The existing prohibition on credential-bearing URLs is unchanged. No Browserbase key was created, purchased, or inserted, and a fully configured hosted Browserbase integration remains a separate task.

## Verification

- New regressions failed before the fixes: readiness (2 failures), MCP output/status (2 failures), backend runtime filtering (1 failure).
- MCP, API route, browser-tool and transcript regression: 27 suites, 283 tests passed (`/tmp/rift-mcp-full-regression.log`).
- Backend plus configuration regression: 68 suites, 1,025 tests passed (`/tmp/rift-mcp-backend-regression.log`). These groups overlap; totals are not additive.
- Scoped lint and whitespace checks passed.
- The final production build, including TypeScript, exited zero. Artifact: `.next-ui-release-1789611117196-618ba138`; build log: `/tmp/rift-mcp-readiness-build-final.log`. An initial build caught a spread-argument typing error in the earlier HTTP recovery acceptance script; the explicit invocation arguments were corrected before the successful build.
- A real owner-scoped loader call returned no Browserbase tools and a precise missing-key status. The serving Convex backend was updated with typechecking enabled; deployment exited zero. A fresh post-deployment query confirmed the unconfigured record is excluded and eight other enabled runtime connectors remain.
- RIFT's built-in read-only browser actually rendered `https://example.com` in local server-runtime Chromium: HTTP 200, expected title and text, one request, zero blocked requests. Evidence: `/tmp/rift-keyless-browser-live.json`. This is not a claim that interactive automation or the packaged remote worker browser has been tested.
- The exact release is served separately at `http://localhost:3067`, returns HTTP 200, and loads the authenticated completed conversation. At 390 × 844, Activity opens full-screen, displays the completed 6/6 plan and three completed collaborators, and closes back to the unchanged chat.

## Remaining boundaries

Main web and worker processes were not restarted: earlier owner claims still lack complete cleanup/producer-exit evidence. Backend filtering is deployed; the updated MCP transport result code is in source and the isolated preview, with main worker rollout pending safe maintenance. Historical stored error strings are not rewritten as successful results. Real-device Safari keyboard behavior, all tool providers, long-task reliability, and the first-response latency target are not proven by this MCP regression.

## Additional Activity correction

During the live mobile check, Activity used “Executed” for a historical command with a nonzero exit even though the transcript said “Command failed.” Terminal sidebar entries now retain the outcome from the same envelope classifier used by the transcript. Failed, interrupted, denied and unconfirmed executions have distinct labels. Arbitrary stdout containing “failed” does not turn a successful exit into a failure. Pending approval still uses the exact chat-scoped approval match, and background-start labels are retained.

The new behavioral tests reproduced five failures before the fix. After the correction, five suites passed 120 tests, including terminal extraction, desktop file handling, Activity disclosure and transcript outcomes. Scoped lint passed. Logs: `/tmp/rift-activity-outcomes-red.log`, `/tmp/rift-activity-outcomes-green.log`, `/tmp/rift-activity-outcomes-lint.log`.

The follow-up production build exited zero, including TypeScript. Artifact `.next-ui-release-1789611775678-a2e5ed7d` replaced only the isolated 3067 preview (the earlier 3067 process had no dispatched tasks). Log: `/tmp/rift-activity-outcomes-build.log`. In the actual Brevier chat at 390 × 844, the two historical nonzero-exit commands now show “Failed” in Activity, while subsequent successful commands remain “Executed,” all three collaborators remain done, and the plan remains 6/6. No project commands were replayed. The separate iframe diagnostic server and temporary comparison tabs were closed after the test; viewport overrides were reset.

The mobile preview dialog itself opened and resolved the saved sandbox URL, but its embedded surface appeared blank in the in-app browser. The exact URL returned HTTP 200 and rendered the app normally in a separate browser tab. A minimal independent HTML fixture using the identical sandbox flags reproduced the blank frame in the in-app browser, while Chrome rendered the same iframe at desktop and 390 × 844 widths. This rules out RIFT's React layout as a necessary cause of that particular blank-frame reproduction; it does not establish the cause of the user's original mobile Safari report. No iframe sandbox protection was removed. Evidence: `/tmp/rift-brevier-preview-headers.txt` and `/tmp/rift-brevier-preview-body.html`.
