# Project bots, marketplace and launch verification

Date: 2026-09-09. Target: reference-ui worktree and localhost:3020 preview.

## Implemented

Persistent owner/project-bound bots and private chats; eight role templates with focused curated skill packs; exact selected skill propagation across direct, worker and delegate paths; editable bot profiles; task assignment; written meetings with eligible explicit coordinator; official MCP Registry discovery and existing verified auth flows; compact theme-aware launch UI.

Bot/meeting creation alone starts no run. Meeting participants and assigned task bindings are revalidated server-side. Archiving a bot disables its pending schedules and refuses to interrupt active conversations/meetings. Account deletion includes meeting and bot records.

## Live evidence

An isolated `RIFT Bot QA` project was created through the UI. Orbit and Atlas were created with independent saved chats. Atlas answered a role identity prompt as Atlas/researcher. The UI reported 10 seconds for the run; this is one functional smoke result, not a latency benchmark.

A two-participant meeting was created through the UI. Orbit delegated a bounded arithmetic verification to Atlas. The Activity detail showed Atlas Done, 3.2 seconds and its own result. Orbit returned one final combined answer. During execution the UI navigated to Plugins; the meeting completed in the background and its result was retained on return. Meeting conversation: `/c/d07dcd88-a868-4e38-8273-5e7b4f617e14`.

The first live bot chat exposed misleading `No project` composer text. The context strip now resolves and locks the persisted bot/meeting project; the meeting displays `RIFT Bot QA`.

The Plugins Registry expanded and displayed real remote entries, search and setup actions. This live bounded snapshot reported 514 servers. The count is not a promise of complete Registry coverage or verified provider availability. Existing GitHub and Stripe connections showed Needs attention; no external account was reauthorized during this test.

A manually assigned task persisted and appeared in Tasks. Live verification detected and fixed its missing Run now action. The new action created one durable manual occurrence and dispatched the existing worker; it opened Orbit’s existing private chat, inserted the saved task instructions and completed with “Bot adım Orbit.” The UI reported 8 seconds. The saved task remained manual; no automatic schedule was created.

## Automated evidence

- Integration run: 16 suites, 119 passed, 1 pre-existing skipped test.
- Bot/profile/context UI run: 3 suites, 29 passed.
- Full TypeScript check: passed.
- Diff whitespace check: passed.
- Native launch generator: 5 tests passed. Actual Chromium launch layout/theme/reduced-motion: 3 tests passed.
- Manual task backend/API/worker regression: 5 suites, 46 passed (overlaps some integration suites; do not add counts).
- TaskCenter Run now UI: 12 tests passed.
- Project bot page visually inspected in light and dark; original dark preference restored.
- Additive Convex development functions deployed with system CA validation; production untouched.

## Limits

OAuth consent remains provider-controlled. Some MCP servers require API keys or setup; discovery does not confer authorization. No claim that every catalog provider has been connected and executed. Native launch template changes require packaging the desktop app to replace an already installed boot artifact. No long-duration or competitor performance parity claim is made from these smoke checks. Test bots created before final focused-pack defaults retain their original saved selections by design.
