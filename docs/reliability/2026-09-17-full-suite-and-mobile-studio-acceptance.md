# Full suite and authenticated mobile-width acceptance

## Source verification

The full Jest command completed successfully on the current working source, including the Local presence recovery change:

```sh
pnpm exec jest --maxWorkers=2 --json --outputFile=/tmp/rift-full-suite-0917.json
```

- 821 suites passed, zero suites failed.
- 8,450 tests passed, zero failed, one skipped (8,451 total).
- The skipped case is `reads the official live registry through the production adapter` in the MCP registry catalog suite. The live registry is not covered by this result.
- Raw receipts: `/tmp/rift-full-suite-0917.json` and `/tmp/rift-full-suite-0917.log`.

## Authenticated UI observations

The existing authenticated Brevier conversation was opened on immutable release `.next-ui-release-1789622329697-b58b73c3`, port 3080. The browser's supported viewport capability was set to 390 × 844, without copying credentials to another environment.

- Activity loaded from the mobile toolbar into a full-screen dialog. The plan showed 6/6 and all three collaborators showed Done.
- Opening Pixel displayed its saved result, findings and next actions. Back to activity and closing the dialog returned to the conversation.
- The dialog measured 390 × 844 and the document width stayed 390; there was no horizontal overflow in this state.
- Studio opened from mobile navigation. Light theme had a white header and document width 390.
- The Video filter displayed only the five video models in the current catalog.
- Selecting Material study inserted its editable brief and selected an image model. No generation was submitted.
- Temporary QA drafts were cleared with normal Select All / Backspace keyboard events. The browser automation's `fill('')` had not cleared the field, so that earlier observation was not treated as a product persistence defect.
- The original dark theme and normal viewport were restored after inspection.

## Practical limits

This is authenticated responsive-browser coverage, not a physical iPhone keyboard test. A desktop browser narrowed to 390 pixels retains its desktop pointer media queries; its computed input font cannot prove the coarse-pointer Safari zoom safeguard.

Activity's historical failed commands remained visible. The completed conversation contains subsequent recovery from a missing video utility and a build configuration error; those records were not hidden or changed into successful operations.

The embedded preview in the Codex in-app browser still requires separate confirmation. Earlier direct-browser preview checks and the in-app-browser blank-frame reproduction do not establish that every user's Preview flow works.

The inspected immutable release predates the Local presence change. The full source suite includes it; the next packaged build is recorded separately. No production worker was restarted or promoted during these checks.
