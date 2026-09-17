# Authenticated mobile acceptance gate

Follow-up to the eight isolated mobile browser checks recorded in
`2026-09-11-native-consent-and-rendering.md`.

## Authentication fixture repair

The root E2E setup still targeted a two-step WorkOS login and detected old session
cookies. Production uses Convex Auth with Email, Password and Sign in on the same
form. The cache path also treated navigation after cookie injection as sufficient
authentication evidence.

The repaired setup uses the actual login UI, restores full browser storage state,
and verifies both the authenticated viewer and current entitlement tier against
Convex before accepting or saving a session. It no longer supplies built-in test
credentials. Tier accounts must be distinct after the application's email
canonicalization. Private storage files are ignored and saved with mode 0600.
`pnpm test:e2e:setup` now invokes this setup directly; the absent WorkOS user
provisioning commands were removed. Its three setup cases were collected without
logging in or changing account data.

Twelve isolated regressions passed. These cover helper behavior; no actual login,
account creation, model submission or billing change was performed. Root mobile
test discovery still collects 71 entries. Collection is not execution.

## New route coverage

`e2e/mobile-acceptance` is a separate, no-submit suite using an externally supplied
complete Playwright storage state and expected account email. It verifies the
actual Convex identity and live authenticated UI. It does not replace auth with
fixtures or alter the production gate.

The suite collects 132 cases across Chromium and WebKit at 360, 390 and 430 CSS
pixels. It includes the main routes, nine settings sections, navigation drawer,
and optional externally specified existing chat/run/project records. Required
controls are checked for viewport bounds, clipping ancestors and overlay hit
testing; screenshots and browser errors are recorded in ignored artifacts.

Review found that the first version could accept the Agents loading surface and
miss automatic Convex WebSocket writes such as referral notifications being marked
seen. The suite now waits for loaded, enabled Agents controls and intercepts
Convex Mutation/Action messages before forwarding, including on replacement
connections. Auth/subscriptions and query replies remain real. Blocked writes
fail acceptance rather than receiving fabricated success replies.

Sixteen separate harness regressions passed in Chromium and WebKit, using a local
WebSocket/HTTP server to verify which messages actually arrived. These validate
the test guards, not the authenticated product screens. The E2E helper and mobile
files also passed ESLint.

The missing-configuration check exits before browser launch with an explicit
configuration error. No authenticated storage state or tier credentials were
available in this checkout, so **authenticated route tests have not passed or
produced acceptance screenshots**. Setup instructions live in
`e2e/setup/README.md` and `e2e/mobile-acceptance/README.md`.

This gate also does not establish physical-device keyboard/safe-area behavior,
long model runs or desktop competitor performance parity. Those remain separate
acceptance requirements.

## Real public mobile release checks

The maintained `e2e/mobile-public` suite ran against the rebuilt production
preview at localhost:3020: 12 cases passed across Chromium/WebKit and 360/390/430
CSS-pixel widths. It checks actual anonymous login/signup controls, clipping,
five-point hit testing, forward/reverse keyboard traversal, focus outlines and
a 500-pixel-height viewport. It never submits forms or creates accounts.

The focus audit exposed a real Tailwind outline interaction: `outline-none` kept
the outline style disabled despite focus width classes. AuthForm now explicitly
sets `focus-visible:outline-solid`. Both browser engines verified the result.
This closes public auth-screen checks only, not the authenticated 132-case gate.
