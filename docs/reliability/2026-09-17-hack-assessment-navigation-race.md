# Hack assessment navigation race

## Live reproduction

On release `.next-ui-release-1789623568465-4f3a9640` (3081), the authenticated workbench was narrowed to 390 × 844. After opening an existing completed session, New assessment was clicked and a harmless test prompt was immediately entered and submitted. The previous editor remained interactive during the server route transition. The request was admitted to the previous session, then the visible page changed to an empty new session.

The initial empty page did **not** prove that submission had failed. A separate ordinary Runs page showed the new run `bb497f4e-e201-4af8-9452-48b4b285c14a` on the previous session `3ac7ae9b-f3ef-4947-9bac-680fd17d7ad6`. No second submission was made. A replacement draft was cleared before returning to the admitted run.

## Change

`HackSessionEntry` now wraps both New assessment and Previous assessment navigation in a React transition. While a destination is loading, the existing workbench stays mounted but is inert, with an accessible Opening assessment status. This preserves the existing producer subscription while preventing clicks, typing and form submission against the previous session. Once the route commits, the existing account/session key mounts the destination workbench and interaction resumes.

The fix does not stop a running operation, change session permissions, or route a request to a different account.

## Validation

A regression uses a genuinely suspended route update to keep navigation unresolved. Before the change it failed because the old workbench had no inert ancestor. After the change it verifies the old workbench remains inert until the route resolves and the new session becomes interactive.

- Session entry, server access gate and workbench lifecycle suites: 64 tests passed.
- Red receipt: `/tmp/rift-hack-navigation-red-0917.log`.
- Green receipt: `/tmp/rift-hack-navigation-green-0917.log`.

The admitted live request was recovered through Runs → Open Hack session. Its one terminal command printed `RIFT_MOBILE_NAV_START`, slept for 60 seconds, and printed `RIFT_MOBILE_NAV_END`. The normal action approval was visible and approved once. While the workbench still displayed that operation as active, the UI navigated back to the app and then returned to the same session. The saved work log contained one action with both terminal markers and the final response reported exit status 0. No target was contacted, file written or tool installed by this test.

This proves recovery for that live browser navigation case. It does not prove worker process death recovery, arbitrary mobile background suspension, all provider failures, or a zero-error production guarantee.

## Packaged validation

TypeScript, scoped ESLint and diff whitespace checks passed. The production build completed with exit 0 and produced `.next-ui-release-1789624179010-9fc0a666`, served separately on 3082. In the authenticated actual Next.js page, immediately after New assessment the Opening assessment status was present and the old editor had an inert ancestor. After the destination committed, the status and inert ancestor were gone and the new command field was empty. No request was submitted during this verification.

Receipts: `/tmp/rift-hack-navigation-typecheck-0917.log`, `/tmp/rift-hack-navigation-lint-0917.log`, `/tmp/rift-hack-navigation-release-0917.log`.
