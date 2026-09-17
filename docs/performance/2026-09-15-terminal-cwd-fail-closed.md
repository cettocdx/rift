# Terminal directory failure and fresh startup evidence

Current mixed live probe: `/tmp/rift-current-mixed-startup.json` and `.log`. All three provider runs completed; the terminal scenario failed acceptance. Its captured output showed `cd: /workspace: No such file or directory`, followed by the sentinel and exit code zero. One command submission was observed, without duplicate events. Provider completion is not proof of task correctness.

Root cause: foreground supervised commands prefixed the user shell list with `cd ... &&`. For `pwd; printf ...`, only `pwd` was conditional: the second command ran after the directory failure. Changed the child prefix to `cd ... || exit $?`, followed by the user command on its own line. Failed directory changes now exit before any user command while allowing the supervisor to record the exit receipt. This does not create missing directories or silently redirect execution.

The regression executes the actual submitted child shell via Bash, not only a mocked exit. It failed before correction (`/tmp/rift-cwd-red.log`) and all 46 terminal tests passed afterward (`/tmp/rift-cwd-green.log`). Separate usage/provider-observer checks passed 48 tests. Native checks remain blocked by Xcode's license acceptance requirement, despite `xcodebuild -version` reporting Xcode 27.

Startup observer receipt times: greeting 22,974ms, explanation 8,631ms, terminal text 18,846ms (first tool input 10,581ms). Admission was 16,328 / 1,648 / 1,818ms. These are three different tasks on development infrastructure, not a representative percentile benchmark or native render measurements. The initial pre-handler delay needs further attribution. Less-than-four-second response remains unproven. The missing /workspace source still requires investigation; the execution safety correction alone does not resolve workspace provisioning.

No live worker was forcibly restarted, and no historical result was overwritten.

## Explicit cwd attribution

Read the original terminal input from the same run's saved `ui` stream using the authorized API. The model explicitly supplied `cwd: /workspace`; this path did not originate in project provisioning or default directory selection. The benchmark's previously filtered input had omitted cwd, hiding this distinction.

Tool parameter guidance now says to omit cwd for the configured checkout/default (/home/user in Cloud), and to supply only a verified path. Benchmark evidence retains cwd alongside the command. No automatic directory creation or silent fallback was introduced. All 46 terminal tests and 11 startup-scenario tests passed. Prompt guidance reduces ambiguity but cannot guarantee model compliance; the fail-closed shell guard enforces the execution behavior. A fresh deployed live probe remains necessary.

## Current worker live acceptance

Worker 20260915.9 loaded without a forced restart. Fresh terminal run `run_06ga7p1r2ipova6haoompmd001` / chat `d5cfaccb-88a2-45f3-adfa-04313b75090e` passed scenario acceptance: model selected `/home/user`, exactly one observed command, matching output, exit zero and final marker. `/tmp/rift-cwd-live-current.json` preserves evidence. This validates the successful directory path; Bash regression tests cover nonexistent directories.

Admission 3,199ms, first tool input 11,255ms, first text 21,875ms, total 25,913ms. This is not a speed improvement claim.

Three older unreleased claims were inspected against authoritative provider status: `run_06ga43decmant60vag088rc601` FAILED, `run_06ga3bsgaj5gm0ue48hpn8ji01` CANCELED, `run_06ga39o7lmqeqlgrdkhcfm0r01` COMPLETED. They are not three running workers. Cleanup metadata is unconfirmed for the first and third, absent for the canceled run. Authenticated application cancellation/reconciliation returned 202 cleanup_pending for all three; subsequent inventory still had three unreleased claims. No rows were manually released and no missing exit evidence was fabricated. Legacy remote resource cleanup remains unresolved.
