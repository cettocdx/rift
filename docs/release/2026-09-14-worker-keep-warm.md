# Keep healthy local worker processes warm

The supervised Trigger CLI was already kept alive by launchd. Its development execution pool independently expired idle child processes after 30 seconds. The pinned trigger.dev 4.5.4 pnpm patch now suppresses that timer when RIFT_TRIGGER_DEV_KEEP_WARM=1. RIFT's development/preview worker scripts opt in; the installed preview LaunchAgent also sets it. The supervisor was reloaded after an idle inventory check.

The patch survives installation through pnpm-workspace.yaml and pnpm-lock.yaml. No timer pings, synthetic tasks or extra model calls are added. Default SDK behavior without the flag, pool size (2), execution recycle cap (10), forced teardown, version retirement and shutdown remain intact. Thus this removes idle expiration, not restart-on-update or OS sleep. The first process is still created on demand.

Installed SDK regression test passed: default timeout exists, warm mode schedules none, same healthy instance is reused, execution cap retires, version deprecation retires, forceKill and shutdown still clean up. ESLint passed. No web rebuild is needed for this supervisor-only patch.

Live proof: /tmp/rift-keepwarm-proof.json. Two completed/verified explanation runs on worker 20260914.22, build-codex/medium, zero duplicate events. Waited 40 seconds after the first benchmark completed before starting the second. Both have identical module probe start 1789384108600 and ready 1789384108731. Uptime grew from 549 ms to 104710 ms: same execution process survived and was reused. First visible text was 15967 ms then 7703 ms; this is not a controlled overall latency/SLO claim. Under-four-second target remains open.

Installed LaunchAgent: /Users/cetto/Library/LaunchAgents/app.riftsys.ui-preview-worker.plist. Prior configuration backup: /tmp/rift-worker-before-keepwarm.plist. To restore SDK idle behavior, remove the flag or set it to 0 and reload only when idle.
