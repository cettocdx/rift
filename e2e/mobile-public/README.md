# Public mobile route acceptance

This maintained suite tests the actual running `/login` and `/signup` pages in fresh anonymous browser contexts. It never starts a server, runs the root authentication setup, loads credentials or saved sessions, fills fields, creates accounts, activates OAuth, or submits forms. Non-read `/api/` requests are blocked and make the test fail; no successful response is mocked.

Run from the repository root, after building and starting the app separately:

```sh
pnpm exec playwright test --config e2e/mobile-public/playwright.config.ts
```

The default origin is `http://localhost:3020`. Set `MOBILE_PUBLIC_BASE_URL` to another running HTTP(S) origin when needed:

```sh
MOBILE_PUBLIC_BASE_URL=http://localhost:3010 pnpm exec playwright test --config e2e/mobile-public/playwright.config.ts
```

No dotenv file is loaded. Use the project's installed Playwright Chromium and WebKit browsers. To discover cases without visiting any page:

```sh
pnpm exec playwright test --config e2e/mobile-public/playwright.config.ts --list
```

The `*.acceptance.ts` filename avoids the root suite's default `*.spec.ts`/`*.test.ts` discovery. There are 12 cases: two real routes × 360/390/430 CSS-pixel widths × Chromium/WebKit, using an 844px viewport height. Every case always checks geometry **and** keyboard focus; there is no skip-focus mode.

Checks cover all nine visible controls: home links, Google sign-in, email/password fields, the primary submit button, the inline account-switch link, and legal links. Required controls must stay within the visual viewport, pass clipping-ancestor and five-point overlay hit tests, and meet 24px target dimensions (with the explicit sentence-inline exception for the account-switch link). Fields remain empty and buttons are measured without activation.

The suite follows natural forward and reverse keyboard navigation and requires a visible black outline at least 2px wide. WebKit's default Tab behavior visits text fields only, so its full-control keyboard path uses Option+Tab and Option+Shift+Tab; Chromium uses Tab and Shift+Tab. No DOM focus-order override is applied. A final 500px viewport-height check verifies that the focused password field remains reachable and unobscured. This is browser emulation and reduced-viewport evidence, not a physical mobile software-keyboard test.

The shared geometry and diagnostic helpers live in `e2e/mobile-acceptance/`. Only the exact observed WebKit notice `Viewport argument key "interactive-widget" not recognized and ignored.` is classified separately, retained in the report. Other viewport notices, the same text from other engines, uncaught page errors, and other console errors fail.

Screenshots (initial page, email keyboard focus, reduced-viewport password focus, final state), geometry/focus measurements, console diagnostics, and attempted writes are saved and attached to the JSON report under the ignored `results/` directory. No generated evidence is committed.

Source discovery currently exposes no forgot/reset-password page or control in the authentication surface. Email verification requires submitting signup and is not covered. Anonymous-page passes do not establish authenticated app-route acceptance; that separate suite requires externally supplied real storage state.

The audit that preceded this suite found a missing auth-field focus outline caused by `outline-none` retaining Tailwind's outline style. The source fix adds `focus-visible:outline-solid`; `e2e/mobile-acceptance/auth-focus.harness.ts` tests the production classes with the installed Tailwind compiler in both browsers. A running immutable release must be rebuilt to include that fix. Collection or source-level regression success is not a passing live route run; run this suite against the updated release to obtain that evidence.
