# Explorer navigation and refresh

The Explorer exposed tree semantics but keyboard focus lived on nested buttons,
with no arrow navigation. Treeitems now own focus and state. The tree uses one
Tab stop, Up/Down/Home/End traversal, Right expansion/first child, Left collapse/
parent, and Enter/Space activation. Mobile activation retains the existing editor
surface behavior. Coarse-pointer rows and refresh controls are at least 44px.

Refreshing the root previously left cached child directories unchanged. A failing
provider regression reproduced stale `src/before.ts` after replacing it with
`src/after.ts` in the adapter. Forced root refresh now refreshes known cached
branches too; requests for the same path still coalesce.

Focused component/provider/mobile tests: 13 passed. The 24-case browser suite
covers three coarse mobile widths and desktop in Chromium/WebKit: keyboard
traversal, single tab stop, target geometry, nested refresh, Enter file opening,
edit retention, save and failed-save retry. It uses the real provider and Explorer
with an in-memory adapter and textarea editor boundary. Separate real Monaco
coverage checks actual editor integration. These do not replace authenticated
whole-app or physical device acceptance.
