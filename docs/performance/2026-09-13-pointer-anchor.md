# Streaming disclosure pointer anchoring

WebKit occasionally delivered pointerdown to the disclosure button but pointerup to prose at the same screen coordinate. The click therefore targeted a common ancestor, not the button. Recorded geometry showed the hit-tested painted position differed from the freshly laid-out button bounds while skipped history materialized.

The scroll owner now anchors primary interactive presses to their control. When the measured bounds exclude the actual press, the control is kept under that pointer. Normal text selection and secondary presses do not detach bottom following. Serialized anchors include safe interactive selectors, including role buttons, so reopening history with changed heights restores the control position.

Regression verification: 25 hook tests pass, including three reopening cases that failed before the selector restoration fix (expected 220px, actual 460px). The initial pointer-anchor implementation failed a real WebKit replay; geometry evidence led to the stale-hit correction rather than treating it as a React state failure.

Uninstrumented WebKit code/600 final replay: 200 history rows, 8 sustained interactions, 2 successful disclosure toggles, retained draft/link and final text. Frame p95 22ms, worst 70ms, three frames above 50ms, none above 100ms. Earlier corrected code repeats had worst frames 57ms and 48ms; mixed/1200 had worst 105ms, three above 50ms and one above 100ms. These are bounded fixture results, not proof of desktop parity or absence of all stalls.

Opt-in event diagnostics include pointer/mouse/focus target and bounds to preserve evidence if the issue recurs. They are disabled in acceptance runs. This change does not hide failed tools or establish recovery from provider/network failures.

Full validation: ESLint for changed hook/test, local CLI package check, TypeScript, and all 737 Jest suites passed (7,281 tests passed, one skipped, 24 snapshots).
