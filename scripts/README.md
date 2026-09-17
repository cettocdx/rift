# Development Scripts

This directory contains utility scripts for local development and testing.

## Legacy account utilities

The former WorkOS/Redis account-provisioning and rate-limit reset scripts are
absent from this checkout. Do not use their historical instructions as a release
procedure. Current authenticated E2E setup is documented below and does not
change accounts, permissions, or billing limits.

## Other Scripts

### E2E authentication

`pnpm test:e2e:setup` signs in and verifies existing Convex Auth test accounts.
It does not provision users, reset passwords or assign subscriptions. See
[the setup guide](../e2e/setup/README.md) for required private configuration.
The former WorkOS test-user provisioning scripts are absent and their package
commands have been removed.

### E2B Sandbox Management

```bash
# Build development E2B sandbox
pnpm e2b:build:dev

# Build production E2B sandbox
pnpm e2b:build:prod
```

### S3 Security Validation

```bash
# Validate S3 security configuration
pnpm s3:validate
```

## Harness performance and recovery checks

Run the reproducible regression gate from any directory:

```bash
node scripts/verify-harness.cjs
```

It runs the worker/tool/SDK and retained-chat suites, root type checking, standalone CLI compilation/tests, and the quality-report validator. It does not start paid model requests. A passing regression run alone is not a release-readiness claim.

With the UI Preview service on port 3020 and its development worker running, collect live evidence:

```bash
node scripts/benchmark-agent-startup.cjs --samples 3 --output /tmp/rift-startup.json
node scripts/benchmark-agent-startup.cjs --samples 1 --disconnect --output /tmp/rift-recovery.json
node scripts/benchmark-agent-startup.cjs --scenario explanation --samples 3 --output /tmp/rift-explanation.json
node scripts/benchmark-agent-startup.cjs --scenario terminal --samples 1 --output /tmp/rift-terminal.json
# Twenty total requests, rotating greeting → explanation → terminal:
node scripts/benchmark-agent-startup.cjs --scenario mixed --samples 20 --persisted --output /tmp/rift-mixed.json
node scripts/verify-harness.cjs /tmp/rift-startup.json /tmp/rift-recovery.json
```

The benchmark makes real authenticated model requests using the installed CLI's existing configuration and the existing `.env.local` Trigger configuration. Its default origin is localhost; `--origin` accepts another HTTP(S) origin. Each request uses a fresh chat ID, temporary unless `--persisted` is supplied. It does not change authentication or print credentials. `--model` accepts a configured Build model ID; the default is `build-codex` with medium effort. Startup and disconnect samples must remain separate: the disconnect test deliberately waits for completion before reading again. Invalid, missing, duplicate and conflicting options fail before dependencies or authentication are loaded; `--help` also needs no credentials.

The default `greeting` prompt remains `merhaba`. `explanation` asks for a short explanation of absolute and relative paths, requires a nonempty finished response and a unique final sentinel, and rejects every observed tool attempt. This validates delivery and tool abstention, not factual correctness or explanation quality.

The finite `terminal` scenario explicitly selects Cloud (`e2b`) and full tool approval for one planned command: `pwd; printf '%s\n' 'RIFT_TERMINAL_<sample-id>'`. The prompt prohibits edits, network requests, media, delegation and command retries. Acceptance requires exactly one observed `run_terminal_cmd` submission in foreground noninteractive exec mode, the exact planned command, one matching `output.result`, actual exit code 0 without an error/unknown outcome, exactly the absolute working-directory line plus the unique literal, and the final response sentinel. Model text alone cannot pass. Reports retain only that matching command/result (output capped at 8 KiB), including exit code and duration; unrelated tool payloads and credentials are omitted. Full approval is also retained for the existing `--terminal-soak --samples 1` mode. These are evidence checks, not a tool-permission sandbox: unexpected model actions cause failure when observed, and the harness does not prove provider-side exactly-once execution.

`mixed` rotates the three scenarios within `--samples` (1–20 total, not per scenario). The report includes per-scenario counts/timings and separate `scenarioVerified` evidence; the quality gate rejects failed or missing scenario evidence and rechecks the recorded terminal command/output. Existing reports without scenario fields retain their original contract. A 20-sample mixed report does not establish 20 samples per scenario or a per-scenario SLO.

Offline checks (no credentials, SDK calls, shell commands or models):

```bash
node --test scripts/__tests__/startup-scenarios.test.cjs scripts/__tests__/startup-benchmark-offline.test.cjs scripts/__tests__/harness-quality.test.cjs scripts/__tests__/terminal-soak-evidence.test.cjs
```

Initial startup targets are median first text ≤4 seconds and p95 ≤8 seconds, with at least 20 samples before a startup report can pass. Three samples are useful for debugging, not percentile confidence. The script does not turn missing/failed runs into fast successes. The disconnect check requires completion while detached, final delivery and zero duplicate event IDs. These are initial checks, not a substitute for the remaining model matrix, long-task, packet-loss and desktop rendering tests.

The combined command deliberately exits nonzero if a live target fails, even when every regression test passes. Reports remain available for diagnosis.
