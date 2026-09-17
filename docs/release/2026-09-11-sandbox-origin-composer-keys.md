# Sandbox configuration ownership and composer keyboard handling

## Sandbox origin

Sandbox managers and the tool factory retain a run-entry snapshot of the E2B template, allowlisted connection settings and terminal recon credentials. List, connect, create and failed-sandbox cleanup use that origin even if a later worker attempt changes its environment. Both ordinary and PTY terminal paths retain captured credentials; caller-provided extra environments retain their existing precedence. Local relay and signing configuration are separate outstanding work.

The installed E2B SDK used truthy environment fallbacks, so supplying an absent access token or `debug: false` was insufficient. The existing pinned E2B patch now adds an opt-in `environmentFallback: false` setting to its CJS/ESM runtime and type entries. Default callers retain their previous behavior. The existing PTY backpressure patch is preserved. SDK configuration reconstruction and pagination/header tests exercise the installed dependency, with HTTP boundaries replaced and no paid sandbox calls.

Worker process reuse remains disabled. This patch does not establish a startup latency improvement, production isolation or provider billing reconciliation.

## Composer keyboard ownership

Cursor's native Agents window was used directly again, including the model menu and slash palette; the IDE was not opened and no task was submitted. RIFT's native preview independently reproduced an editing defect: in an otherwise empty draft, `/cle` followed by Shift+Return invoked Clear and emptied the draft. The document-capture palette handler ran before the textarea's editing and IME guards.

The handler now leaves composing/keyCode229 events and modified keys to normal editing/navigation. Regressions use the actual ChatInputTextarea to verify Shift+Enter preserves the text and inserts a newline, Shift+Tab moves focus backward, and IME confirmation neither clears nor submits. Existing plain palette selection remains covered.

Long descriptions such as `/goal` and `/mcp` still truncate in the narrow native menu. A touch-accessible, bounded selected-command details region is a separate follow-up; this change does not shrink touch targets or restyle rows. Native post-build verification is recorded in the external release report after serving the build.
