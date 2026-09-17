# Authenticated E2E setup

The current application uses Convex Auth. The historical WorkOS provisioning scripts are absent; their obsolete package
commands have been removed. This setup never creates users, assigns
paid tiers, mocks authentication, or invokes a model.

Use existing, email-verified Convex Auth accounts with password sign-in enabled.
Supply credentials through the process environment or the ignored `.env.e2e`
file. No default credentials are used. Required for the full setup project:

- `PLAYWRIGHT_BASE_URL`: the exact origin serving the current release build.
  Keep the same hostname when saving and using state; `localhost` and
  `127.0.0.1` are different origins. Without it the root config uses port 3010.
- `NEXT_PUBLIC_CONVEX_URL`: the same Convex deployment used by that build.
- `TEST_FREE_TIER_USER` and `TEST_FREE_TIER_PASSWORD`.
- `TEST_PRO_TIER_USER` and `TEST_PRO_TIER_PASSWORD`.
- `TEST_ULTRA_TIER_USER` and `TEST_ULTRA_TIER_PASSWORD`.

The three accounts must resolve to distinct canonical email addresses; plus
aliases of one inbox do not provide tier isolation. The `ultra` test key retains
the application's internal tier name. Tier checks use real Convex subscription
entitlements; no billing mutation or test entitlement override is performed.

The root config loads `.env.e2e`, not `.env.local`, into the test process. The
running application still needs its usual deployment configuration. No service
role key is needed for session verification.

On an already-running release server, execute only authentication setup first:

```sh
pnpm exec playwright test --project=setup --workers=1 --reporter=list
```

The root Playwright config starts `pnpm dev:next` if its target is unavailable;
verify the intended release server is running before using this command. To
verify discovery without starting services or logging in:

```sh
pnpm exec playwright test --project='Mobile Chrome' --project='Mobile Safari' --list --reporter=list
```

Setup restores each complete storage-state file in its own browser context,
waits for signed-in UI, and verifies the actual session with the authenticated
`users.viewer` and `subscriptions.getMyEntitlements` Convex queries. Expected
email and tier must both match. Missing, stale or wrong-account state triggers
one clean login through the real Email/Password/Sign in form. A login is saved
only after the same identity and tier verification succeeds.

Verified state is saved to ignored `e2e/.auth/{free,pro,ultra}.json` with mode
0600; the directory is created with mode 0700. Login traces, screenshots and
videos are disabled. Keep state files private and never paste their contents.

For a no-submit mobile route pass, use `e2e/mobile-acceptance` and its separate
configuration. The legacy root chat/agent suites send real model requests,
upload files and modify chat metadata. Their seed/cleanup helper currently
returns no user ID, so they are not a clean route-acceptance shortcut.
