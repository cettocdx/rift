# Hack HTTP interruption audit — 17 September 2026

The preview has neither RIFT_DURABLE_HACK_ENABLED nor RIFT_DURABLE_DISPATCH_ADMISSION enabled. Hack therefore runs through /api/hack-chat (370s preemptive timeout, 420s route maximum), not a detached worker. Web stdout records an actual 370006ms timeout on 16 September. The screenshot alone does not identify that particular run.

The previous web maintenance gate inspected only agent_run_claims and Trigger producer states. It could report safe while an HTTP Hack producer was executing inside Next. A preview restart occurred after HTTP activity; it may have interrupted the user's task. The gate now also inventories hack_http_executions and blocks admitted/running or unknown/incomplete inventories. It does not release or falsify HTTP terminal acknowledgments.

Live gate: one HTTP execution still marked running; canRestartWeb=false. Do not restart the web process merely because the worker-only inventory is terminal. The record may be orphaned, but remote tool termination is not proven by elapsed time.

The Latest activity visible label was replaced with a compact chevron and accessible Scroll to latest output label. New source tests: 133 Hack lifecycle/durable tests and 7 maintenance gate tests passed. The UI release is built separately; no live restart while the gate blocks.

Remaining: reconcile the HTTP execution with actual local/remote ownership evidence; complete the documented hosted durable Hack admission/reconnect/Stop acceptance and enable its two flags only once worker/backend compatibility is established. Removing a timeout from the HTTP producer alone cannot make it independent of the web process.
