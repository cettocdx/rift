# Embedded preview reload revalidation

The standalone preview reload already called `health.retry()`. Embedded previews
use WorkbenchBrowser, whose reload only refreshed the web iframe or native browser
tab. A saved sandbox pausing while the panel stayed visible therefore left the
old running status on screen even after the user pressed Reload.

WorkbenchBrowser now notifies its owning preview on explicit reload. The owner
performs the same read-only status check used by standalone preview. Native
browser actions and web iframe reload still run normally. Ordinary browser tabs
have no callback. Stop, back and forward do not request preview revalidation.
An authoritative paused result displays the existing resume action; resuming
uses the existing saved-environment endpoint, not task submission or replacement
sandbox creation. Existing transient-check handling retains the verified frame.

Evidence:

- Before correction: 3 new regressions failed, 39 existing tests passed.
- After correction: 50 tests passed across browser, preview health and copy.
- Scoped ESLint passed.
- Preview status/resume server tests: 49/49 passed, including saved-preview
  ownership, stale identity and observation/resume behavior.
- Real component browser fixture: 6/6 passed in Chromium and WebKit at widths
  360, 390 and 430. Each loaded the iframe, changed the simulated backend status
  to paused, tapped Reload, observed the paused state, resumed, and saw the
  preview return. The composer draft survived. Exactly one POST was made, to
  `/api/preview/resume`; no Build task was replayed.

Logs: `/tmp/rift-preview-reload-red.log`, `/tmp/rift-preview-reload-green.log`,
`/tmp/rift-preview-reload-lint.log`, `/tmp/rift-preview-reload-browser.log`.

The browser test uses controlled status responses; it is not proof that every
live provider or expired sandbox is recoverable. This does not resolve the
separately reproduced in-app-browser iframe limitation or live worker rollout.

Production build exited 0. Immutable output
`.next-ui-release-1789618676296-eccd8511` is running separately on port 3076.
In the authenticated saved Brevier chat, the real sandbox was initially paused;
the existing Resume action returned the panel to Preview running without a new
chat submission. Reload was exercised and no console error appeared, but the
in-app browser frame still remained loading. This is health/resume evidence,
not successful live iframe rendering. The main web and worker were not restarted
and no public deployment was promoted.

Additional receipts: `/tmp/rift-preview-reload-server.log`,
`/tmp/rift-preview-reload-release-build.log`.
