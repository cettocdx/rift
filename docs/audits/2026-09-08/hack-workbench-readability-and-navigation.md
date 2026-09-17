# Hack Workbench readability and navigation

## Confirmed causes
- Every transcript update forcibly scrolled to the bottom, interrupting reading.
- Completed reasoning expanded at once. Tool output also expanded automatically.
- The final answer changed from streamed lines into a large report card when the SDK reached ready; this altered its layout and typography.
- Hack used a route-owned SDK reader, outside the authenticated chat shell's retained reader provider.
- Opening `/hack` without a session generated a new UUID every time, so reopening the sidebar destination showed a new session rather than ongoing work.
- “Tasks 50” represented the capability catalog, not active jobs. Session readiness percentages were fabricated presentation values.
- Initial activity claimed an isolated sandbox was opening before any tool invocation. A full recon preset appeared selected for an ordinary explanation.

## Changes
- True black workspace and transcript; quiet raised surfaces; RIFT UI font, 14px answer text / 24.5px line height, compact controls and neutral focus styling.
- Reader-controlled following with a Latest activity button. Streaming updates preserve earlier reading positions.
- Collapsed reasoning and terminal output; stable Markdown presentation before and after completion.
- Account-scoped retained SDK registry moved above route segments; Hack uses the same retained reader infrastructure and reconnect handling. Stop still cancels both the local reader and server stream.
- Window/account-scoped last Hack session restoration. Explicit session URLs take precedence. Account changes cannot inherit a previous account's saved session.
- Removed guessed target and readiness percentages, distinguish selected task from observed tool count, disable preset execution until scope and task are selected, show activity based on actual events.
- Security prompt explicitly limits tool use to the current objective, answers explanations directly, and disallows choosing a demo target or expanding a narrow task into a broad assessment.

## Verification
- 78 targeted Jest tests across 11 suites passed (reader retention, reconnect, cancellation, transcript bounds/following, route access, session restoration and account isolation).
- TypeScript `tsc --noEmit` passed.
- Two live TLS explanation requests: zero tool invocations. The second was submitted without explicitly banning tools.
- Left the workbench during the second response through the App link and returned through the main sidebar. The original session and both responses remained available; no additional user prompt was submitted.
- Browser inspection: workspace and transcript backgrounds `rgb(0, 0, 0)`; answer font `14px / 24.5px Geist`; focused composer has no box shadow and a neutral gray border.
- Verified summary-card values remain visible and task sidebar opens with compact type.

## Remaining execution boundary
Navigation continuity does not make the producer indefinitely durable. The existing Hack route still has a 420s platform ceiling and a 370s preemptive stop; its time-limit handoff is deliberately not automatically replayed like Build. A killed server, expired sandbox or uncertain terminal side effect cannot be declared recovered by a visual reconnect. This change does not promise unlimited execution or repeat uncertain operations automatically.
