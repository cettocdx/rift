# Isolated web release candidate — 17 September 2026

## Why the main processes were left running

The current worker maintenance inventory has 405 claims: 397 released and 8
active. The web maintenance gate still cannot establish producer-exit evidence
for every historical claim/HTTP execution. No claim was deleted, no run was
replayed, and no existing producer was terminated to roll out UI changes.

Instead, a separate Vercel deployment was created using the production target
with `--skip-domain`. This creates new server instances without killing the
existing web processes or promoting the public domain.

## Source and packaging

Source: `/Users/cetto/RIFT-Release`. A private temporary snapshot contains only
existing tracked and non-ignored source files, further filtered by the actual
`.vercelignore` rules using Git's ignore matcher. The project link contains IDs,
not account tokens. `.env.local` is not included; `.env.example` is the only
environment file. Exact matches to 18 configured private secret values were
checked in source-like files under 2 MB; none were found. This is a bounded
check, not a complete historical secret audit.

The upload exclusions now also omit film working files, root review PNGs,
`.superpowers`, mobile fixture results, temporary output, and local immutable
build pointers/configurations. No source file was deleted. The candidate has
3,629 files / 177,678,923 bytes; 3,359,365,316 bytes were excluded. Runtime assets
under `public` and workspace build sources remain included.

Local provenance:

- `/tmp/rift-web-candidate-path.txt`
- `/tmp/rift-web-candidate-source-manifest.json` (per-file SHA-256)
- `/tmp/rift-web-candidate-worktree-stat.txt`

## Deployment

- Candidate: `dpl_ATGXv9vsAxJcEtvv8p8tqJ7zqDt4`
- URL: `https://rift-6fa0u7esx-tddd8m7bjm-7313s-projects.vercel.app`
- Previous/current public deployment: `dpl_69h639AQ2cFthJfGiZ3sVB2zggzi`
- Public URL inspected after creating the candidate still resolves to that
  previous deployment, not the candidate.

The CLI's `--no-wait` response said "ready" while `vercel inspect` correctly
reported Building. Treat the authoritative inspection/build state as the
delivery result, not that early CLI message or HTTP 200 from the platform's
"Deployment is building" placeholder.

## Validation status

The first candidate built successfully, including remote TypeScript. Its
anonymous chat stream and preview status requests returned 401; GET on the
reconciliation route returned 405 (method enforcement, not authentication proof).
The 12 release configuration and maintenance-gate tests passed.

It was **not promoted**. The first full Jest run found 9 failures across 4
suites; the deployed mobile auth sweep found 12 failing cases. Investigation
separated stale expectations from defects:

- Preview lookup spread `message.parts` without checking for legacy/malformed
  history. The new regression failed before the guard; text-only messages now
  cannot crash the transcript or hide older valid preview evidence.
- The code-copy test trimmed the expected source while the implementation
  correctly preserves the trailing newline. The viewport test still expected
  a raw meta tag after migration to Next's typed viewport export. Desktop
  origin fixtures omitted desktop presence after the relay gained a live
  presence check. Updated fixtures retain the owner/signature assertions.
- Mobile auth links had sub-44px hit areas, a global faint focus rule overrode
  the auth surface, and inputs used 14px text. Scoped visible focus, 44px link
  targets and 16px mobile inputs address those failures; desktop typography
  stays compact. The browser check now uses the actual dark palette and
  checks input font size without disabling user zoom.

After correction, 69 focused tests passed. The complete second Jest run passed
818 suites, 8,402 tests and 24 snapshots; one test is skipped. Scoped ESLint and
`git diff --check` passed. These are not physical-device or live-worker proof.

## Second candidate

- ID: `dpl_2YiazYFJKf2bddJ5hNdpFrkrfAfA`
- URL: `https://rift-m5vzgoj5e-tddd8m7bjm-7313s-projects.vercel.app`
- New private source snapshot: 3,630 files / 177,683,308 bytes.
- `/tmp/rift-web-candidate-v2-source-manifest.json` records per-file hashes.
- Compared with the first snapshot, only the eight fix/test files and this
  report changed; no source was removed and no additional environment file
  was included. `.env.example` is still the only environment file.

The second deployment was Ready, but browser revalidation found one remaining
issue: the signup page's short "Sign in" link was about 41px wide. All six login
cases passed. The link now has a 44px minimum width as well as height; the 18
auth/desktop-redirect tests and scoped lint passed after this final change.

## Final browser-verified candidate

- ID: `dpl_D1tu7BEz5mzgbeQmNimdAMxCiRDu`
- URL: `https://rift-g6lahw98s-tddd8m7bjm-7313s-projects.vercel.app`
- Ready; remote compilation took 83s and TypeScript 54s.
- Only AuthForm's hit-target width and this report changed since candidate 2.
- Final deployed auth suite: **12/12 passed**, Chromium and WebKit at
  360/390/430px; includes forward/reverse keyboard focus, 44px touch areas,
  16px input text and reduced-height viewport checks. No credentials or other
  API writes were submitted.
- iOS 26.5 Simulator Safari was also manually checked on candidate 2, whose
  input and keyboard behavior is identical: software keyboard opened, email
  to password navigation kept the field visible, no visible scale jump,
  dismissal restored the layout. The simulator receipt explicitly records
  visual observation rather than numerical viewport-scale instrumentation.

Authenticated candidate end-to-end tasks, physical iPhone background behavior
and main-worker rollout remain separate requirements. No preconfigured E2E
account credentials were available. The public domain was re-inspected after
candidate 3 and still resolves to `dpl_69h639AQ2cFthJfGiZ3sVB2zggzi`; it has not
been promoted. No existing worker or web process was terminated.

Logs: `/tmp/rift-web-candidate-deploy.log`,
`/tmp/rift-web-candidate-build.log`,
`/tmp/rift-public-deployment-after-candidate.log`,
`/tmp/rift-web-candidate-delivery-checks.log`,
`/tmp/rift-release-candidate-full-jest.log`.

Second-pass logs: `/tmp/rift-preview-legacy-red.log`,
`/tmp/rift-candidate-fixes-green.log`,
`/tmp/rift-release-candidate-full-jest-2.log`,
`/tmp/rift-candidate-v2-lint.log`,
`/tmp/rift-web-candidate-v2-deploy.log`.

Final receipts: `/tmp/rift-web-candidate-v3-source-manifest.json`,
`/tmp/rift-web-candidate-v3-ready.log`,
`/tmp/rift-web-candidate-v3-mobile-public.log`,
`/tmp/rift-mobile-public-v3/`,
`/tmp/rift-ios-auth-keyboard-acceptance.json`,
`/tmp/rift-public-deployment-after-v3.log`.
