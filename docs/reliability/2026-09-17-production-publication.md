# Production publication — 17 September 2026

## Web

- Published reviewed snapshot from `/Users/cetto/RIFT-Release` to deployment `dpl_AewWvi8twZxNhkFWLNPt4UgydQy2`.
- Candidate: `https://rift-djrlslxsv-tddd8m7bjm-7313s-projects.vercel.app`.
- Built with production environment and `--skip-domain`; promoted only after Ready and public acceptance checks.
- `vercel inspect https://riftsys.app` resolves to the new deployment with Ready status.
- Public production verification: `/login` 200, unauthenticated `/api/mobile/session` 401.
- Candidate mobile public suite: 12/12 passed across Chromium and WebKit at 360/390/430 widths. This is not physical iPhone or authenticated long-task coverage.
- Snapshot includes local-presence retry and Hack assessment-navigation protection. The latter passed 64 focused tests plus TypeScript, lint and authenticated packaged UI navigation validation before publication.
- Snapshot manifest: `/tmp/rift-web-publish-0917-manifest.json`.
- Logs: `/tmp/rift-web-publish-promote-0917.log`, `/tmp/rift-web-publish-domain-0917.log`, `/tmp/rift-web-publish-mobile-0917.log`.

## Separate release surfaces

- Installed desktop's port 3020 server and main Trigger worker were not restarted or updated by this publication.
- Main web maintenance gate still could not prove safe producer exit; no restart was forced.
- Latest local immutable web package runs on port 3082 (`.next-ui-release-1789624179010-9fc0a666`).
- App Store Connect showed zero builds. The account's Apple notification identifies build 0.1.0 (1) rejection `ITMS-90474`: missing iPad portrait-upside-down orientation. Upload success on 16 September did not mean processing acceptance.
- Preparing build 2 with all four iPad orientations; iPhone orientation behavior retained.
- Build 2 subsequently passed all 49 native tests, archive/signature verification, upload and Apple processing. `RIFT Internal` now shows 0.1.0 (2) **Testing** and the account holder **Invited**. See the TestFlight distribution receipt for full details.
