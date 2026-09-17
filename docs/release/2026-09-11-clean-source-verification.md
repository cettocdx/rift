# Clean source verification — 2026-09-11

The existing working tree was placed on `codex/release-candidate-2026-09-11` and
committed as baseline `52191260c20ed622cc9e1d980e3b4da58cf62eb4`. The baseline was cloned
with `git clone --no-hardlinks` into `/Users/cetto/RIFT-Release`. No existing
`node_modules`, `.env.local`, build directory or runner credentials were copied.
The clone uses its own Git directory. pnpm reused verified package-store entries;
this was a fresh dependency installation, not a cold network-download benchmark.

## Completed checks on the independent checkout

- `pnpm install --frozen-lockfile`: passed, pnpm 10.33.2 and Node 22.23.1.
- `pnpm typecheck`: passed, including generated Next route types.
- Full Jest: 611 suites passed; 5,366 tests passed, 1 skipped; 24 snapshots passed.
- `pnpm lint`: passed.
- Production web source build with documented nonfunctional fixture settings: passed
  (113 static-page generation steps); no whole-project tracing warnings.
- Git status after web, desktop, CLI builds and tests: empty; tracked source unchanged.
- Desktop launch/source-config Node tests: 16 passed.
- Console Node tests: 56 passed.
- OpenTUI: 10 passed, 46 assertions.
- Local runner TypeScript build: passed.
- Actual `node-pty` shell probe: zsh printed the expected marker and exited 0.
- Standalone ARM64 CLI: built; isolated install, help, auth isolation, update backup
  and intentional corrupted-package rejection all passed.
- Desktop: canonical `packages/desktop` Tauri build produced an ARM64 `RIFT.app`.
  `codesign --verify --deep --strict` passed. This is an ad-hoc signature with no
  Apple Team ID and no notarization, not an approved distribution package.

## Source hygiene

854 change records were captured in the baseline, including the current web,
harness, CLI and desktop work. Generated coverage, temporary exports, raw QA logs,
Next type references, desktop launch HTML and Tauri schemas are excluded. The
original files and raw evidence remain on disk; their source counterparts generate
new outputs during clean builds. No reset, history rewrite or remote push was used.

The candidate's 2,728 tracked files were scanned for common secret formats and exact
matches to configured local secrets. One environment-matching setup-guide value was
replaced with a placeholder; the repeated scan had no findings. This is a current-tree
check, not a historical or exhaustive secret audit. Runtime credentials were not rotated.

An MCP registry runtime-cache read was being traced as a source asset, drawing the
whole project into Next's bundle analysis. It is now explicitly excluded from asset
tracing; the clean-clone build no longer emitted those broad-pattern warnings.

The first web build in an entirely empty environment failed at Convex and Stripe
client initialization during page-data collection. The documented source-only build
uses a nonfunctional Convex URL and dummy Stripe key. It does not validate live
providers, authentication, billing or background workers. See SOURCE-HANDOFF.md.

## Scope

This closes the uncommitted-source and clean-checkout packaging gap. It does not
close the remaining startup latency, production worker, long-session acceptance,
multi-user isolation, backup/restore or Apple distribution gates. The running Preview
services retained their original working directory at this baseline checkpoint.
The web service was subsequently moved explicitly to the independent checkout;
see `SOURCE-HANDOFF.md` and the later dated acceptance reports for current runtime
locations and results.

Detailed logs for this verification are stored locally under `/tmp/rift-clone-*` and
`/tmp/rift-clean-*`, and are not part of the source repository.
