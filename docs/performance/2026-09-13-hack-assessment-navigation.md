# Fresh Hack assessments and draft navigation

The workbench now exposes **New assessment** and a **History** menu on desktop and mobile. New assessment pushes a fresh UUID route. History offers the previous committed assessment for the same account and the existing All runs destination. Navigation does not send a request, cancel a run, or replay commands. An active retained run and an unconfirmed exact Stop remain attached to their original assessment.

The target, unsent command, selected preset and attachments now belong to an account/session draft in window memory. A new assessment starts empty; returning restores its draft. Upload callbacks retain their original store and stable file identity, so a late upload or deletion cannot affect another assessment or a replacement attachment. Hack uploads use the cloud sandbox preference. Only the existing account/session selection ID goes into sessionStorage; draft contents and raw files are not persisted there or in localStorage.

## Evidence

- Navigation regression tests failed first because New assessment was absent; the draft remount test failed because the target was lost. Previous assessment tests also failed before its route/menu was added. Logs: `/tmp/rift-hack-fresh-navigation-red.log`, `/tmp/rift-hack-drafts-red.log`, `/tmp/rift-hack-previous-red.log`.
- The final bounded Hack set passed **10 suites / 86 tests**, including A draft → New B → Previous A, account isolation, late uploads, attachment-specific sending/clearing, and a pending exact HTTP Stop surviving A → B → A without another send/cancel/resume. Log: `/tmp/rift-hack-fresh-bounded-final.log`.
- The upload hook's focused tests cover delayed upload completion after a store switch, removal without resurrection, and concurrent backend deletion preserving file identity.
- `node scripts/verify-hack-assessment-navigation.cjs` bundles the production header, Radix menu, typography and workbench CSS in an isolated WebKit page. At **320, 360, 390, 600, 601, 700, 768 and 1280px**, controls remain inside the viewport without collisions or horizontal page overflow. Keyboard History and Previous assessment selection work while busy, with zero Run/Stop callbacks and no page errors. Log: `/tmp/rift-hack-fresh-webkit-final.log`.

## Limits

Unsent drafts and their previous-selection shortcut survive route remounts in this window, not reloads, closed windows or another device. All runs remains the persisted run history. The lifecycle tests mock retained chat/network boundaries; the WebKit fixture verifies header behavior and geometry, not native titlebar dragging, physical mobile keyboards or a live security execution. No paid run or security scan was launched for this change.
