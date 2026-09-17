# Publishing a Build app to Vercel

Built 18 Aug 2026. The "Yayınla" button used to copy the preview link to the
clipboard — the label promised something the button did not do. It now deploys
the app.

## Why publishing exists at all

The preview URL belongs to the E2B sandbox that produced the app, so it dies
with the sandbox. Observed the same day: a run finished, the sandbox was
reclaimed, and the preview pane read *"The sandbox immeh952f20vc6lui9uta wasn't
found."* A preview is not a place to send anyone.

## The flow

1. Reconnect to the user's sandbox — `ensureSandboxConnection` resumes a paused
   one rather than starting over.
2. Find the project (most recently modified `package.json` outside
   `node_modules`) and its build output (`dist`, `build`, `out`, `public`),
   running `npm run build` when there is no built output yet. Publishing the
   dev tree would ship unbundled sources only a dev server can serve.
3. Upload each file to `POST /v2/files`, keyed by **SHA1** — Vercel verifies
   `x-vercel-digest` as SHA1, and a SHA-256 is rejected as an invalid digest.
4. `POST /v13/deployments` referencing those digests, `target: "production"`,
   with all-null `projectSettings` so Vercel serves the output as-is instead of
   detecting a framework and building it a second time.
5. Poll until `READY`, then hand back the project alias.

Uploading by digest rather than inlining base64 is what keeps app size from
being capped by an HTTP body limit.

## Two decisions worth keeping

**The address is the alias, not the deployment hostname.** Every publish mints a
new `<project>-<hash>-<team>.vercel.app`; only `<project>.vercel.app` survives
the next publish. Handing out the per-deployment hostname would mean every link
a user shared went stale the moment they republished.

**The project name carries its owner** (`kor-9f2a1c`, six hex characters of the
user id). One RIFT team holds every published project, so without the suffix two
users who both name their app "kor" collide — and the second publish deploys
over the first user's live site.

## Files

| Piece | Where |
| --- | --- |
| Vercel client: upload, deploy, poll, naming | `lib/publish/vercel.ts` |
| Title → slug | `lib/publish/subdomain.ts` |
| Output discovery, path safety | `lib/publish/build-output.ts` |
| Record of what was published | `convex/publishedSites.ts`, `published_sites` |
| Endpoint | `app/api/publish/route.ts` |
| Button | `app/components/BuildPreviewPanel.tsx` |

## Rules, and why

- **50MB and 400 files per app.** Enough for a real app, small enough that a
  runaway output cannot be pushed at Vercel unattended.
- **`.env*`, `.git`, `node_modules`, and any path containing `..` are never
  uploaded.** Vite copies `public/` verbatim, so a stray `.env` reaching
  `dist/` is an ordinary accident — and publishing it would put it on the open
  web.
- **Authenticate before anything else.** Whether this deployment has publishing
  configured is not something an anonymous caller needs told.
- **Vercel's own refusals are passed through.** An invalid token, a plan limit,
  or a name conflict carries an explanation the user can act on; replacing it
  with a generic apology would waste it.

## What still needs doing by hand

Set two environment variables. Until `VERCEL_TOKEN` is present the endpoint
answers 503 and the button does nothing, rather than half-deploying.

```
VERCEL_TOKEN=<a token from vercel.com/account/tokens>
VERCEL_TEAM_ID=<team id, if the token belongs to a team rather than a personal account>
```

Scope the token to the team that should own published apps. Every user's app
becomes a project in that team, named `<slug>-<owner-hash>`.

## Status

Verified end-to-end on 18 Aug 2026 with a real Build's output:

- `POST /api/publish` → 200 in ~10s (3 files).
- `https://araba-yarisi-oyunu-yap-347abe.vercel.app/` → 200, serving the app's
  own `<title>KOR</title>`, with the sandbox that built it long gone.
- Both the project alias and the per-deployment hostname resolve; the alias is
  what the UI hands back.
- Unauthenticated `POST /api/publish` → 401.

One migration was needed along the way: rows written by the earlier
self-hosted variant carried `subdomain`/`files` and no `deployment_id`, so
Convex refused to deploy the new schema at all until they were removed. Worth
remembering — a schema change is blocked by existing documents, not just by new
writes.

## What was replaced

A self-hosted variant of this feature — wildcard subdomains under the product's
own domain, files served from Convex storage through a middleware rewrite — was
built and verified end-to-end the same day, then replaced by this one at the
owner's direction. The pieces that survived the switch are the sandbox-reading
and path-safety layers, which never depended on where the bytes end up.
