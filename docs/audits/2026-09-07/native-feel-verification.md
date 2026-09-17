# RIFT desktop interaction improvements

September 7, 2026. Implemented in `codex/reference-ui-rebuild`, delivered to the local **RIFT UI Preview** bundle serving localhost:3020. The installed production RIFT app and public site were not deployed by this pass.

The diagnosis covered actual use of RIFT's conversation, Activity, browser, Settings, Studio and Plugins/Skills surfaces, plus native window/menu source. Supplied references informed the direction. This is not a claim to have operated or measured Codex desktop directly.

## Changes

| Before | After | Why |
| --- | --- | --- |
| macOS Control chords could trigger app navigation while editing text. | Application modifier is platform-specific; native text Control chords pass through. | Keep macOS editing conventions intact. |
| Reload targeted the whole app even when using its embedded browser. | Reload prefers the focused browser, then the visible browser; explicit Reload RIFT is separate. A failed browser reload never falls back to destroying the app view. | Preserve the conversation, draft and open tabs. |
| Native child browser focus isolated New Chat, Search and Settings shortcuts. | Native menu accelerators deliver actions to the main app view. | Commands work across the window, including embedded pages. |
| Descendants of the title bar interrupted window dragging. | Deep drag region with Tauri's interactive-control exclusions. | Titles and blank regions behave as window chrome. |
| Native appearance was pinned dark and material was always active. | App theme synchronizes to native appearance; material follows window activation. | Match web content, dialogs and native window appearance. |
| Splash artwork lay outside its SVG viewBox. | ViewBox covers the artwork. | Keep startup visually coherent. |
| Settings changed navigation width, weight, row spacing and idle contrast. | Shared sidebar geometry/typography and the user's current sidebar width. | Avoid a visible jump into another interface system. |
| Back to app always discarded the previous route. | Return to the prior app page, including conversation IDs and query/tab selection. | Preserve the user's place across settings sections. |
| More could not close on one of its own child pages. | Explicit collapse is respected; newly entered child routes reveal once. | Make the control respond to its advertised action. |
| Plugins/Skills switching discarded filters and scroll position. | Visited panels retain state; hidden panels are inert and close transient portals. | Preserve work while switching context. |
| Extensions used fixed dark grays and inconsistent functional text scales. | Semantic surface colors and shared type roles. | Keep theme and text preferences consistent. |
| Studio cycled through incompatible loading layouts. | One skeleton shares the real stage geometry; functional typography follows appearance tokens. | Reduce layout disruption while loading. |
| Activity led with empty sections, counters and execution metadata. | One empty state; populated sections; optional run/execution details; current-run plan filtering. | Make the work and results easier to read. |
| Keyboard tab navigation could wait for smooth scrolling. | Keyboard reveal is immediate; pointer selection remains smooth, with reduced-motion support. | Keep repeated keyboard actions responsive. |
| The command palette heavily dimmed and blurred the whole workspace. | A lighter, unblurred veil with immediate open/close. | Keep the working context visible during frequent searches. |

## Live desktop observations

- Light and dark Settings now use the same compact rail as the app. Enlarging the UI text to 15px was also visually checked in Settings; this does not claim a full 16/18px cross-page audit.
- Studio's loading and loaded two-column layouts were inspected in the actual native window.
- More collapsed while Plugins was the active route. The hidden child was indicated on More.
- Entered `GitHub` in Plugins, switched to Skills, and returned: the query remained and the GitHub row was still filtered. No connector authorization was initiated.
- Empty Activity showed one explanation and optional run details, with no empty Plan/Agents/Operations blocks.
- The rebuilt native app opened Search with Command-K from both the composer and the embedded browser. One palette appeared; Escape closed it. Browser page state survived. Browser-origin close restored main-view focus rather than asserting exact child-field focus restoration.
- With a draft in the composer and the browser address field focused, Command-R reloaded the local browser fixture. The draft and browser tab remained. No model request was submitted.
- Control-A followed by Control-K in the composer deleted the draft line using native editing behavior; no palette opened.
- Command-comma opened Settings from the loaded saved conversation. Back to app pointed to that exact conversation through a subsequent Appearance section visit.
- The preview was rebuilt and restarted after confirming its terminal was an idle shell. Test browser tabs/drafts were closed/cleared. Production app bundle was untouched.

## Scope limits

These fixes address measured interaction failures and visible inconsistencies; they do not establish complete visual parity with another app. Full cross-platform testing, durable Activity elapsed timestamps, browser extensions/download management, and new agent performance benchmarks were outside this pass. Settings return tracks pathname/query; hash-only navigation remains outside that mechanism. Visited Plugins/Skills panels retain their live subscriptions until the workbench unmounts.

## Final automated checks

- 23 JavaScript/React suites, **261 tests passed**, exit 0: `/tmp/rift-native-feel-consolidated-tests.log`.
- Native Rust suite, **37 tests passed**: `/tmp/rift-native-shell-final.log`.
- Full TypeScript check, exit 0: `/tmp/rift-native-feel-typecheck.log`.
- Scoped root ESLint, exit 0: `/tmp/rift-native-feel-root-lint.log`; delegated source checks were also clean.
- Native preview build, exit 0: `/tmp/rift-native-shell-build.log`. Copied the completed bundle to `dist/RIFT UI Preview.app` and launched it for the checks above.
- Scoped whitespace/diff validation passed. This is not a claim that every unrelated test in the large pre-existing working tree was run.
