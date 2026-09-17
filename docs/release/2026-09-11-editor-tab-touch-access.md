# Workspace file-tab touch access

The actual Workspace editor hid close controls until mouse hover and exposed only 20px targets. Coarse/no-hover devices now show close controls with real 44px targets; selection targets also reserve 44px. Empty and populated tab strips both reserve 46px on coarse input, eliminating the height change when the last file closes. Fine-pointer density remains 35px/20px with hover and keyboard focus visibility.

WebKit's horizontal scrollbar intercepted lower close-target points on overflow tabs. The strip retains scrolling but hides the scrollbar using a scoped inline scrollbarWidth override (the application's unlayered global scrollbar rule defeats layered utility precedence) and WebKit fallback. This does not change global scrollbar styling.

Fourteen offline Chromium/WebKit cases passed at 360/390/430 coarse/fine and desktop: actual component/global CSS, five-point hit testing, independent selection/close actions, 12-document overflow, Arrow/Home/End, fine-pointer wheel input and last-tab closing. Existing two keyboard unit tests passed. Mobile swipe on a physical device, dirty-file confirmation and authenticated backend document transitions are not covered by this fixture. Coarse cases use taps, keyboard scrolling and actual hit tests; no claim of physical swipe verification is made.

Baseline invisible-control and empty-state-height failures were retained before their fixes. Final evidence: /Users/cetto/RIFT-Reports/2026-09-11-editor-tabs-access-audit.md; /Users/cetto/RIFT-Reports/2026-09-11-editor-tabs-green.json; /tmp/rift-editor-tabs-acceptance.log. Parent reviewed the final Chromium390 coarse screenshot. Final combined commit/build checks follow the focused browser evidence.
