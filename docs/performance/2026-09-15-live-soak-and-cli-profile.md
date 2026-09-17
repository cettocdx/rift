# Live soak and CLI profile

## Active 20-minute continuity probe

Run `run_06ga7v0nriou6qbe51kvrlhp01`, chat `e0644a08-2790-4e91-8a76-4e780b8c8cad`. Started using benchmark-agent-startup with --terminal-soak --samples 1 --soak-steps 120 --disconnect --persisted against localhost:3046. One read-only shell loop emits a marker every ten seconds; no user files are edited. The observer detaches after terminal input and follows the same run, then reconnects for the receipt. This is transport observation detachment, not worker-death simulation or an operating-system network outage.

Completed at 2026-09-15T07:53:51Z. The same task returned COMPLETED on worker 20260915.10. Acceptance evidence: exactly one matching command and one matching result, all 120 ordered markers, duration 1,206,367ms, exit code 0, final RIFT_SOAK_DONE and zero duplicate events. completedWhileDetached is true. The original observer was not restarted or the task resubmitted.

This proves one 20-minute shell task continued across observer detachment. It does not prove worker death recovery, OS network outage, all model workflows or zero future failures. Replayed firstText timing includes 20 minutes of intentional detachment and must not be reported as first-token latency.

Evidence copied to `2026-09-15-twenty-minute-reconnect.json`; verifier inspects the command, duration, ordered markers and result receipt, not only the provider status.

## CLI measured renderer workload

/tmp/rift-tui-performance-current.json: 1,000 history entries × 30 lines, 1,000 live lines, 90 measured output updates and ten input samples per terminal size. Unsent draft retained at 80×24, 126×46, 180×60.

Input plus renderer visual-idle p95: 16.72 / 17.78 / 16.42ms. Update handler p95: 14.96 / 10.64 / 5.96ms; maximum 81.74ms in first size. Update plus visual-idle p95: 43.48 / 39.65 / 36.39ms. Includes renderer scheduler wait and excludes real PTY, physical display and model latency. A single outlier is not sufficient causal evidence to rewrite the rendering path or claim competitor parity.

## Isolated text formatting

270 measured paintEntry calls with 1,000 plain lines: p50 0.043ms, p95 0.054ms, max 0.131ms. This workload does not attribute the earlier 81.74ms update outlier to text formatting. No speculative formatting rewrite was applied.

### Cleanup remains unproven

A fresh Trigger retrieval after result inspection reports `status=COMPLETED`, `cleanupStatus=unconfirmed`, `cleanupConfirmed=false`. Thus command continuity passed, but the end-to-end cleanup/release gate did not. Do not treat this probe as a full lifecycle acceptance pass. Investigate the missing resource cleanup confirmation separately; do not manually mark the claim released merely because the command returned exit 0.
