# Workspace refinements — approved direction

User screenshots and recording define the requested design: compact system typography; 500-weight, muted inactive sidebar rows; outlined icons; no sidebar shortcut labels; neutral composer focus; native file selection; explicit execution approval; discrete effort slider; edited file summaries; hoverable conversation markers; visual Studio discovery; orderly preconfigured MCP connections.

Preserve existing chat, upload, model, execution, and OAuth paths. No fake connected states or unavailable OAuth claims. Approval defaults to asking and never expands sandbox access. Verify tool gates and ownership independently from UI styling.

## Implemented

- Sidebar: system UI font at 13px / 500 / 18px, existing 30px row rhythm, outlined 16px icons. Inactive rows use a 66% foreground mix; selected rows use black in light mode and white in dark mode. Removed visible keyboard chords in navigation and the account menu; bindings remain.
- Files: the composer context menu opens the existing computer file picker, including the desktop attachment route. Workspace file browsing remains available. Cloud attachments use the existing upload flow; desktop execution retains local attachment paths and existing workspace grants.
- Composer: neutral border and shadow on focus, permissions on the left and model/effort controls on the right. Effort uses the chosen model's supported values, with a discrete range control and reset.
- Permissions: Ask for approval (default), Approve for me (file edits allowed; commands/connected actions ask), Full access (available tools, within existing account and workspace limits). Policy is sent with the request and enforced in both runtime paths, including rebuilt/fallback MCP tool sets. Pending requests are owner-bound, run-bound, expire, and approved decisions are consumed once. A rejected/expired request stops the tool loop and persists a terminal finish reason so automatic continuation cannot restart it. Approval-controlled Build runs use the Rift executor rather than OpenCode's independent native executor.
- Transcript: completed edits appear on their own response with file count, changed-line totals, expandable rows and Review opening the existing diff panel. Rejected/pending writes never appear as completed edits. Conversation markers provide message previews and scroll only the conversation; reduced-motion preferences are respected. Pending tools say “awaiting approval”; denied actions say “not approved.”
- Studio: rebuilt around a large model reference, compact capability pane, model gallery, editable prompt patterns and production directions, preserving model selection and real generation actions.
- Plugins: consistent two-column rows, 36px logo plates / 24px marks, normalized descriptions/actions, restrained blue feature banner. Added the actual Browserbase and Firecrawl marks for existing connections. Seventeen curated hosted MCP definitions; every catalog item has a local logo. Existing legacy Firecrawl connections are matched to their provider instead of duplicated.
- OAuth: added Supabase, Atlassian and Firecrawl; enabled Stripe OAuth. GitHub uses Rift's existing registered OAuth application, verifies the returned token against GitHub MCP, and stores encrypted credentials. Reconnect updates the existing connection with revision checking. OAuth reconnects preserve the connection id. Public MCP endpoints still connect without an unnecessary sign-in.

## Verification

- Focused UI, catalog/OAuth route, Convex ownership, tool gating, stream-runner and regression suites passed. TypeScript, targeted ESLint and git whitespace checks passed.
- Native macOS Files dialog opened from Files → Choose from computer and was canceled without uploading a file.
- Native Studio and effort popover inspected. Browser Plugins inspected in both themes: all 18 visible installed/catalog row logos loaded at 24 × 24px with no horizontal overflow. Dark selected navigation measured rgb(255,255,255), inactive approximately #a2a2a2; light selected measured rgb(0,0,0), inactive approximately #626262. Browser theme restored to light.
- Real worker denial test completed successfully on development worker version 20260907.10: run_06g7nq95dnpfhoia6pml8e2k01. Only `pwd` was requested, approval was displayed before execution, Deny ended the run, and no repeat/automatic continuation occurred. A prior QA run exposed a denial-loop bug and was stopped; the regression now exercises the real SDK loop without network calls.
- Convex development functions synchronized with `convex dev --once`; production deployment and the installed release application are unchanged. Active UI is localhost:3020 and RIFT UI Preview.

## Provider references and boundaries

- Stripe OAuth: https://docs.stripe.com/mcp
- Supabase OAuth endpoint: https://supabase.com/docs/guides/ai-tools/mcp
- Atlassian authv2: https://support.atlassian.com/atlassian-ai-gateway/docs/how-to-upgrade-from-atlassian-rovo-mcp-v1-to-atlassian-rovo-mcp-v2/
- Firecrawl hosted OAuth: https://docs.firecrawl.dev/mcp-server
- GitHub host-owned OAuth integration: https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md
- Browserbase mark: https://www.browserbase.com/favicon.svg

Connecting personal provider accounts still requires their sign-in/consent. No new provider accounts were authorized during implementation. Existing GitHub and Stripe connections displayed “Needs attention”; their reconnect actions now enter the appropriate OAuth flow. Providers such as Canva require client onboarding/redirect allowlisting (https://www.canva.dev/docs/mcp/), so unsupported one-click connections were not advertised or fabricated.
