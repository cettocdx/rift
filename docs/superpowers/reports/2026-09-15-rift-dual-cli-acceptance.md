# RIFT dual-engine terminal acceptance — 2026-09-15

## Scope and current state

Local installation of the native Codex-based `rift` command and an OpenCode engine for non-OpenAI RIFT models, using the existing personal RIFT account and credits. No public deployment or Git commit was requested or performed. Both engines are installed and verified. Final argument-parser fixes passed independent review and were included in the final immutable-bundle reinstallation.

## Native CLI verified

- Installed command resolves to `/Users/cetto/.local/bin/rift`; native version `0.4.0-dev`.
- Immutable private bundles and the original legacy executable are preserved under `~/.local/share/rift-native/`.
- 25 warning-strict Python tests passed, including actual packaged-binary routing with config overrides and `--`, incremental HTTP streaming, stalled upstream teardown, foreground SIGINT, and atomic installation rollback.
- Actual account-backed `rift exec --skip-git-repo-check --json -c 'model_reasoning_effort="low"'` read `value.txt` through a shell tool, observed `41`, and returned `RIFT_NATIVE_CLI_OK`; exit 0 and `turn.completed`. File stayed unchanged. Thread `01a0a505-fe3d-7620-a52f-a08322558493`.
- Actual TTY opened, trusted the isolated fixture, displayed the GPT-only model picker, accepted Escape, and exited cleanly on one Ctrl+C. Session `01a0a507-770c-7de0-a5ef-08e1889bdedd`.
- An initial pre-model account-config request timed out at 15 seconds. A diagnostic request took 28.81 seconds; the combined launcher now tolerates a bounded 45-second account handshake. A subsequent native live task completed normally.
- Native Codex warned that installed skill descriptions were shortened to fit its context budget; this did not prevent tool execution or completion.

## OpenCode service verified

- Official OpenCode 1.18.31 macOS arm64 artifact staged privately; SHA256 matches GitHub release metadata. Existing global OpenCode remains separate.
- Gateway/config tests: 47 passed, lint and full TypeScript check passed.
- New preview build `.next-ui-release-1789473936075-0e1bdd91` activated after desktop console was observed Ready. Authenticated native and OpenCode config endpoints return 200.
- Native catalog remains build-codex/build-astra. OpenCode catalog: build-gemini, build-max, build-fable, build-grok, build-kimi, build-glm, build-hunyuan.
- Qwen is excluded because its configured exact provider slug was absent from the public provider catalog at verification time.

## Evidence

Temporary fixture location is recorded in `/tmp/rift-dual-cli-acceptance-location.txt`. Scoped plans and review ledgers remain under `.superpowers/sdd/` because changes are uncommitted.

## OpenCode compatibility decisions

OpenCode receives an ephemeral loopback credential. Its model-generated session title uses the same selected RIFT model and is metered through the same account. Project OpenCode provider/plugin configuration is disabled; RIFT-owned generated configuration remains authoritative. Session data and cache are isolated per RIFT account. Profiles, remote attachment/server modes, and automatic approval overrides are unsupported in this launcher.

## OpenCode live and TTY acceptance

- `rift opencode run ... --model build-fable --format json` completed via the existing RIFT account: actual `read` tool observed `41`, continuation returned `RIFT_OPENCODE_CLI_OK`, stop finish, exit 0; file unchanged. Session `ses_f5ad072d0ffe0o4MpR5nLRwRH2`.
- `rift -m build-fable` automatically opened OpenCode 1.18.31 with Claude Fable 5.1 and RIFT account visible. `/models` worked; `/sessions` reopened the previous read/result transcript after process restart. Ctrl+C exited cleanly.
- OpenCode custom-provider `cost: 0` is not the RIFT billing ledger; usage is settled by the authenticated RIFT gateway. Account credits should be checked in RIFT.
- Installed private OpenCode is 1.18.31; original global OpenCode remains 1.18.15.

## Final verification and operational observations

- Final whole-task review: PASS after the consolidated option-parsing fix. Final Python suite: 35/35 passed in 69.715 seconds; four targeted final-review tests independently passed.
- Installed launcher/helper hashes match the reviewed source. Exactly one original legacy entrypoint backup remains; prior immutable native versions remain available.
- Actual installed hidden attachment form fails with exit 1 before authentication. `rift -m build-fable exec --help` correctly displays `opencode run [message..]` and exits 0.
- During final checks, another manual preview launcher occupied port 3020 while the configured LaunchAgent repeatedly failed to bind. Account endpoints returned 403. The manual preview launcher was identified by script/cwd and stopped gracefully; the existing configured LaunchAgent was restarted without changing account settings or rolling back the current build pointer. Both authenticated config endpoints subsequently returned 200.
- The final active preview pointer is `.next-ui-release-1789477480053-815ec36b`, produced by concurrent workspace work and preserved during service recovery.
- One cold native-config probe timed out after 45 seconds; its subsequent probe returned 200. Remote account-service cold-start latency remains an observed limitation, independent of successful engine/tool tests. Model calls are never automatically replayed because of this handshake.
- Personal RIFT console skill instructions were updated with a backup to reflect the actual dual-engine installation and legacy diagnostic distinction.

## Usage

```sh
rift
rift opencode
rift -m build-gemini
rift opencode run "Read README.md" --model build-fable --format json
```

Use `/model` inside Codex; `/models` and `/sessions` inside OpenCode. Existing open legacy CLI processes must be exited and relaunched to use the new entrypoint.
