# Authenticated mobile route acceptance

This isolated suite visits the running RIFT app with an externally supplied, real Playwright `storageState`. It never runs root E2E auth setup, creates test users, starts a server, seeds data, submits a composer, connects a plugin, changes billing, or invokes a destructive control. Its `*.acceptance.ts` filename is deliberately outside the root Playwright `*.spec.ts`/`*.test.ts` discovery pattern.

## Required inputs

Supply these environment variables explicitly; this config does not load any dotenv file:

- `MOBILE_ACCEPTANCE_BASE_URL`: the running app's exact HTTP(S) origin, such as `http://localhost:3020`. The hostname must match the exported session; `localhost` and `127.0.0.1` are different origins.
- `MOBILE_ACCEPTANCE_STORAGE_STATE`: absolute path to a complete Playwright storage-state JSON exported after a real login, including cookies and origins. Keep it outside the repository. No synthetic cookie, token injection, or authentication-response mock is accepted as evidence.
- `MOBILE_ACCEPTANCE_EMAIL`: the expected account email.
- `NEXT_PUBLIC_CONVEX_URL`: the same Convex deployment used by that app.

The shared `e2e/fixtures/verify-authenticated-session.ts` verifier checks the actual origin's Convex session against `users.viewer` and live entitlements once per browser worker. A wrong account, expired state, missing cookie, or unavailable backend fails the run. Each app route also requires the UI marker rendered exclusively inside the authenticated boundary. The account page must display the same email returned by the live identity query.

The suite never refreshes the supplied state on disk. If it expires, export a new state from a real login outside this suite.

## Run

With the required environment variables already set:

```sh
pnpm exec playwright test --config e2e/mobile-acceptance/playwright.config.ts
```

List cases without authentication or a server:

```sh
pnpm exec playwright test --config e2e/mobile-acceptance/playwright.config.ts --list
```

Run one engine and width:

```sh
pnpm exec playwright test --config e2e/mobile-acceptance/playwright.config.ts --project webkit-390
```

Use installed Playwright Chromium and WebKit browsers. The six projects use 360, 390, and 430 CSS-pixel widths with an 844-pixel height, mobile viewport behavior, and touch-capable device profiles. This is browser emulation, not proof of physical-device or native keyboard behavior.

## Coverage and evidence

The 132 collected cases consist of 18 routes, one navigation-drawer check, and three optional existing-resource checks for each of six projects. Required routes are `/`, `/agents`, `/plugins`, `/runs`, `/tasks`, `/notebook`, `/artifacts`, `/studio`, `/settings`, and every section in the production settings registry.

`/notebook` really redirects to `/hack`. An account without Max is expected to see the authenticated Max gate; the report annotates that result explicitly, and it does not establish coverage of the premium workbench. A Max account instead checks the real workbench command, back, and send controls without activating a command.

For each route, the suite checks its actual primary controls. Agents and supplied-project cases require an enabled project selector, absence of the team-loading status, and a rendered no-project, empty-team, or populated-team surface before measuring controls. Settings checks every rendered control without clicking, filling, or toggling it. The navigation test only opens the drawer and More section, inspects real navigation controls, and closes with Escape.

Geometry checks record control rectangles, the actual primary pointer type, and the visual viewport. Coarse-pointer controls must have an actual hit rectangle of at least 44×44 CSS pixels; fine-pointer controls must have nonzero dimensions. The checks reject viewport overflow and clipping by ancestor scroll/hidden containers, and use five `elementFromPoint` samples to detect covering overlays. Disabled controls still receive size/geometry/clipping checks, but skip pointer hit testing because intentionally disabled controls can have `pointer-events:none`. Offscreen secondary controls are revealed only through user-scrollable ancestors; the harness does not scroll `overflow:hidden` ancestors to conceal a clipping defect. It also verifies scroll regions can reach their end programmatically. This is scroll reachability evidence, not a touch-swipe test.

Each case attaches viewport screenshots, `geometry.json`, console/page errors, and `blocked-writes.json`. Unexpected console errors or attempted writes fail rather than being silently ignored. The exact observed WebKit message `Viewport argument key "interactive-widget" not recognized and ignored.` is retained separately in `browser-diagnostics.json`; the same text from another engine, any other viewport notice, and all application errors still fail. The harness aborts same-origin non-read `/api/` requests (except authentication refresh). Direct Convex HTTP requests permit only the installed SDK's query POST endpoints; mutation, action, and generic function endpoints are blocked.

Before app navigation, `context.routeWebSocket` connects to the real configured Convex server and intercepts outbound frames. `Connect`, `Authenticate`, `ModifyQuerySet`, and `Event` frames forward unchanged, as do inbound replies. `Mutation` and `Action` frames are discarded and recorded without arguments or tokens. Unknown/malformed frames fail closed. The guard applies to new/reconnected sockets too. The use of `connectToServer` and `onMessage` was verified against installed Playwright 1.55 types and implementation. No successful mutation result is synthesized and no production effect is suppressed: a mount-time write such as `referrals:markRewardNotificationsSeen` makes the acceptance case fail explicitly.

Focused synthetic regressions use an in-process HTTP/WebSocket server to prove writes never arrive while auth, subscriptions, and server replies still flow, including reconnections, binary actions, malformed/future frames, and HTTP fallbacks. They also reproduce the agents-loading false pass and compile the production authentication field classes with the installed Tailwind version to verify the rendered keyboard focus outline. Run them without authentication:

```sh
pnpm exec playwright test --config e2e/mobile-acceptance/playwright.harness.config.ts
```

These harness tests use synthetic protocol/DOM data and are separate from authenticated acceptance. Their success does not establish that an app route passes.

Reports and screenshots are in the ignored `results/` and `report/` directories. They can contain private account content; retain them locally or share only through an approved private channel. Traces are off by default because they can contain authenticated payloads. Set `MOBILE_ACCEPTANCE_TRACE=1` explicitly to retain traces on failure.

## Optional existing data

Supply only existing resources owned by the authenticated account:

- `MOBILE_ACCEPTANCE_CHAT_ID`: a completed Build conversation with an assistant response. The route is `/c/<id>`; the test checks rendered response/composer and absence of an active stop control. An unexpected resume submission is blocked and fails.
- `MOBILE_ACCEPTANCE_RUN_ID`: a completed run. The route is `/runs/<id>`; the test requires the real completed status badge and destination control, rejecting missing/foreign records.
- `MOBILE_ACCEPTANCE_PROJECT_ID`: an existing app project. The route is `/agents?project=<id>`; the actual project selector must select that exact ID rather than silently falling back.

Absent IDs produce explicit skips. The suite never invents identifiers or creates data to make these cases pass.

## Verification status

On 2026-09-11, collection succeeded with 132 acceptance cases. The 22 focused harness regressions passed in Chromium and WebKit, including two expected-failure cases proving a reachable 20px coarse-pointer control fails acceptance. Before adding the size gate, these two cases unexpectedly passed and correctly failed the regression run. A small glyph inside a real 44px button passes; fine-pointer compact controls retain their separate size policy. A run without the required environment failed in preflight before opening any browser or submitting a request. No authenticated storage state was supplied during implementation, so actual authenticated route acceptance and screenshot evidence remain unverified. Collection and harness checks are not a passing mobile acceptance run.
