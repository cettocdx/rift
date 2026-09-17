# Isolated hosted canary: resource inventory and next steps

Read-only inventory on 2026-09-11. No deployment, Redis database, user, session, API key, environment variable or other remote resource was created or changed. No live task was submitted. The user has already authorized autonomous testing; the remaining requirements are actual isolated bindings and a genuine QA login, not another general authorization request.

Later progress is recorded in [isolated canary provisioning](2026-09-11-isolated-canary-provisioning.md); the inventory and unexecuted sequence below describe the earlier audit.

## Verified resources and access

| Resource            | Observed state                                                                                                                                                                               | Canary consequence                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Convex account      | Existing local CLI login successfully queried account/project metadata. Team `william-32b56` (494741), project `rift` (2172515).                                                             | A supported named-deployment provisioning path is available. Creation/quota success has not been tested.                                   |
| Convex deployments  | `elated-poodle-998`: `dev/william`, development; `content-robin-881`: `production`, production. Both `aws-eu-west-1`. These are the complete two entries returned by the management listing. | No existing staging deployment. Do not repurpose either deployment or assume the production one is empty.                                  |
| Vercel              | Existing access token successfully read the team project and storage inventory. RIFT project `prj_p1guF3pzgvxHZvwDhVrw4DUbJHbe`.                                                             | Account-managed resource provisioning has a documented API path.                                                                           |
| Redis               | Exactly one Vercel store: `store_5EO7Ji3OC5miOIHT`, `upstash-kv-violet-dog`, available. Its connection targets RIFT **production and preview**.                                              | This is a shared store, not isolated canary storage. No second isolated store was found in that account inventory.                         |
| Upstash integration | Installation `icfg_yMZ8mpLBLFNltTBom9PHmbjq`; Redis product `upstash-kv` / `iap_gpfB8wWHssmOi6P1`. Product metadata supports `dub1`; `primaryRegion` required.                               | An additional account-managed Redis store is possible; no creation or billing-plan selection was attempted.                                |
| Email verification  | Scoped Convex environment reads confirmed `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` are configured on the current dev deployment. Only presence booleans were printed.                         | A sending configuration exists. Its live delivery and access to a genuine QA inbox were not established.                                   |
| QA login            | No configured `TEST_*_USER` / `TEST_*_PASSWORD` names were present in local `.env.local`; no access to a QA inbox was established.                                                           | Obtain a real OTP through the normal signup flow; current deployment cookies/API keys cannot be transplanted into the new issuer/database. |

Trigger inventory remains in [the staging canary gate](2026-09-11-trigger-staging-canary-gate.md): staging exists but lacks application bindings/deployment; hosted production and preview currently share the dev Convex destination/credential, and production has three active schedules. Those labels do not establish isolation. The task-only staging config and restricted launcher have passed offline review; see [configuration evidence](2026-09-11-trigger-staging-canary-config.md). Hosted manifest and binding verification remain outstanding.

Inventory methods: Convex `GET /api/teams`, `/api/teams/william-32b56/projects`, `/api/deployment/elated-poodle-998/team_and_project`, and **`GET /v1/projects/2172515/list_deployments`**. The old `/api/teams/.../deployments` endpoint returned an empty array despite existing deployments and must not be used as the authoritative inventory. Vercel `GET /v9/projects`, `/v1/integrations/configurations`, `/v1/storage/stores`, store details/connections, and integration products. The provider-oriented `/v1/installations/.../resources` returned 403; the installed Vercel CLI's storage-list endpoint returned the inventory above. No credential-bearing response was printed or saved.

## Concrete future sequence — not executed

1. **Create a separate nondefault Convex deployment from an isolated checkout with its own empty `.env.local`.** Clear inherited deployment-key overrides; do not copy the release environment file. The installed Convex 1.39.1 CLI supports the command below. `--select` changes only that checkout's local selection, and `--default` is deliberately absent.

   ```sh
   env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN -u CONVEX_DEPLOYMENT \
     node_modules/.bin/convex deployment create \
     william-32b56:rift:dev/hosted-canary-20260911 \
     --type dev --region aws-eu-west-1 --expiration 'in 7 days' --select
   ```

   Record the returned deployment name/URL and re-list deployments. Confirm it differs from both existing deployments. [CLI reference](https://docs.convex.dev/cli/reference/deployment), [authoritative listing API](https://docs.convex.dev/management-api/list-deployments).

2. **Configure fresh backend authority and auth keys.** Prepare a mode-0600 private environment file with a new random `CONVEX_SERVICE_ROLE_KEY`, fresh `JWT_PRIVATE_KEY`/`JWKS` RS256 pair, `SITE_URL` for the separate canary web origin, and the intended `AUTH_RESEND_KEY`/`AUTH_EMAIL_FROM` sender configuration. Do not copy the existing signing keys, sessions, users or database. The installed `@convex-dev/auth/src/cli/generateKeys.ts` contains the normal RS256 generation recipe. Convex supplies the new deployment's `CONVEX_SITE_URL`.

   ```sh
   node_modules/.bin/convex env set \
     --deployment william-32b56:rift:dev/hosted-canary-20260911 \
     --from-file /tmp/private-canary/canary-convex.env
   node_modules/.bin/convex dev --once --typecheck enable
   ```

   Run the second command only after confirming the isolated checkout's selection. Bulk `env set` without `--force` refuses conflicting existing values. Do not use the shared deployment's `--prod` default. Backend deployment also installs this app's Convex cleanup crons, so the database and any configured storage destination must be isolated; task-only Trigger discovery does not disable Convex crons.

3. **Create separate Redis, using one of these paths.**
   - Short-lived canary: official Upstash documentation supports `POST https://upstash.com/start-redis` with `User-Agent: codex`, no account/API key, and a **72-hour lifetime unless claimed**. The response contains credentials in Markdown, so capture it privately rather than printing it. Example future command after making the private directory:

     ```sh
     (umask 077; curl --fail --silent --show-error --request POST \
       --header 'User-Agent: codex' https://upstash.com/start-redis \
       --output /tmp/private-canary/redis-provisioning.md)
     ```

     This endpoint was documented, **not called**. It is appropriate for a bounded canary, not durable staging evidence. [Upstash CLI/temporary resource documentation](https://upstash.com/docs/agent-resources/cli).

   - Account-managed alternative: Vercel documents `POST /v1/storage/stores/integration/direct` using the existing installation, product `upstash-kv`, a fresh canary name, and metadata `{ "primaryRegion": "dub1", "eviction": false, "prodPack": false, "autoUpgrade": false }`. Omitting `billingPlanId` asks for automatic free-plan discovery; do not fall back to a paid plan without examining the returned requirement. Do not connect this new store to the existing RIFT production/preview project. [Creation API](https://vercel.com/docs/rest-api/integrations/create-integration-store-free-and-paid-plans).

   Bind only the new `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` pair in canary API and worker. Remove inherited `KV_REST_API_*` alternatives. Verify endpoints differ from the shared store and the newly provisioned database starts empty. This is required for hosted paid-ledger migration: `lib/billing/paid-ledger-migration.ts:40` fails closed without Redis in production mode; disabling the limiter is not an equivalent canary.

4. **Create the QA identity through ordinary authentication.** Start the separate web/API instance against the new Convex URL/site URL and service key. Use password signup plus the genuine six-digit email OTP, then sign in normally. No fake OTP, copied production user/session, forged JWT, or service-key replacement for API login. Google OAuth is an alternative only after its new callback destination is configured; the password+OTP path avoids that additional OAuth-console dependency. Relevant code: `convex/auth.ts`, `convex/ResendOTP.ts`, `convex/auth.config.ts`, `e2e/fixtures/auth.ts`.

   A repeated paid-plan benchmark also needs legitimate test entitlement. The existing `convex/admin.ts` grant workflow can grant Pro/Max to the verified QA account **in the isolated database**; label results as admin-granted plan behavior, not real payment acceptance. Then create its API key through authenticated Settings: `convex/apiKeys.ts:80` requires a genuine signed-in user and an active subscription. Store this key in a separate benchmark HOME/config, not the current CLI configuration. This step remains dependent on access to an actual QA inbox; no such access was demonstrated by this inventory.

5. **Wire and verify only staging.** The canary API and task worker must share the new Convex URL/service key and Redis pair; use staging Trigger credentials and the exact canary version. `app/api/agent-long/route.ts:425` forwards `convexUrl` in the payload, so verify that destination too. Allow only the provider/E2B credentials needed for the finite scenarios. Leave shared schedules, relay bindings, payment integrations and existing API environments untouched. Review the task manifest and empty staging schedule inventory before the first normal QA request. Start with one request, then the matched bounded mixed scenario sample. No benchmark/build/deploy was run for this inventory.

## Actual remaining readiness gates

- New isolated Convex and Redis have not yet been created/configured; existing shared resources are unsuitable.
- Real QA inbox access and successful normal OTP sign-in on the new issuer are not established.
- The task-only staging build/deployment manifest and credential binding comparison still need verification after configuration.

These are concrete setup/verification requirements. They are not claims that the already-authorized testing requires a new blanket permission.
