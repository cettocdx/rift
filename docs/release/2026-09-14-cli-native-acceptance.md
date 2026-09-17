# CLI native acceptance — Apple Silicon

Source baseline: bcbcf80. Built `@rift/console` 0.3.5 from the release worktree using Bun compile. The new standalone binary SHA-256 is `65d8b5c4abafaef37df5f9f42cd34bfd7aea517a960df36528841d7987d76390`; the installed `~/.local/bin/rift` is byte-identical. No replacement was needed.

## Verified

- Clean temporary installation, help, isolated unauthenticated config, update backup and rejection of a deliberately corrupted bundle passed (`scripts/smoke-release.mjs`). The checksum-error output in this test is the expected negative case.
- Native OpenTUI tests: 13 passed, 73 assertions, zero failures. These include Stop/second Ctrl+C, draft/menu exit and question interactions.
- New repeatable `scripts/verify-pty.py` exercised the compiled binary in actual 120×40 PTYs, with empty separate config and no model request. Both empty and unsent-draft states exited after one Ctrl+C, exit code 0, restoring all captured termios attributes.
- Observed first render: 673ms and 489ms. Ctrl+C exit: 75ms and 74ms. Two samples establish functional acceptance, not a performance percentile or model response-time claim.
- `rift --json doctor --online` against the configured localhost:3020 service: authenticated, reachable, 10 models. This reused the existing personal key without printing it; it is not a clean browser-login proof.

- Live local-session harness test against localhost:3020: a fresh empty session used `read_file` on a unique temporary file and returned its unpredictable contents in the assistant response. Status ready, zero errors, total 5562ms. This invokes the current CLI session source directly; the compiled native PTY was tested separately.
- The Mac currently has one Apple Development signing identity, but no Developer ID Application distribution identity. Development signing is not a notarized public distribution proof.

## Still incomplete

- Public `https://riftsys.app/api/console/config` returned HTTP 404 on 2026-09-14. Public CLI onboarding remains unavailable until the actual service is deployed and verified. Do not disguise this by silently selecting localhost.
- Clean browser login, a real local tool task, approval, reconnect and interrupted-task restoration need integrated release acceptance.
- Intel Mac/Linux execution, publisher signing/notarization and public distribution are not proved by this Apple Silicon test.
- This CLI's local model/tool loop and Cloud mode have different lifetimes; closing the local process does not promise continued local work.
