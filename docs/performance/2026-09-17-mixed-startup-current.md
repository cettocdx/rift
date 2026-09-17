# Current mixed startup evidence

Six bounded live Build tasks ran sequentially against production-built preview 3057, model selector `build-codex`, medium effort, development worker version `20260916.15`. Three temporary chats and three persisted chats each covered greeting, explicit tool-free explanation, and one harmless terminal command.

| Storage   | Scenario    | First text | First executable tool input |
| --------- | ----------- | ---------: | --------------------------: |
| Temporary | Greeting    |   5,993 ms |                           — |
| Temporary | Explanation |   7,160 ms |                           — |
| Temporary | Terminal    |   6,157 ms |                    6,733 ms |
| Persisted | Greeting    |   4,406 ms |                           — |
| Persisted | Explanation |   5,446 ms |                           — |
| Persisted | Terminal    |   7,918 ms |                    9,411 ms |

All six authoritative runs completed; scenario verifiers and cleanup confirmation passed, with zero duplicate stream events. Greeting verification checks completion/no tools, not semantic quality. Explanation verification checks nonempty final text/sentinel/no tools, not factual quality. Terminal verification checks the exact command and its output. First text in a tool task may be progress commentary and is not proof of command completion.

Persisted admission took 1,251–1,404 ms. The temporary migration path intentionally checks legacy tagged runs and is not a substitute for measuring ordinary persisted-chat admission. Current skill reads took 203–681 ms; the earlier 17-second backend-read stall did not recur. Persisted first preparation finished at worker +1,183/+1,945/+1,286 ms. The subsequent first-chunk intervals were 1,001/1,357/4,498 ms, including SDK/network/provider work, not pure provider TTFT. Overlapping setup spans must not be summed.

The persisted sample median is 5,446 ms; the under-four-second target remains unmet. This is one sample per storage/scenario, not a percentile SLO, production-load benchmark, or competitor comparison. The main user application was not restarted or measured. Do not attribute changes versus the older exploratory run solely to code: backend/provider load and the environment differ.

Evidence: `/tmp/rift-mixed-startup-0917.json`, `/tmp/rift-persisted-startup-0917.json` and corresponding `.log` files. Each JSON retains exact run IDs and allowlisted timing/cleanup observations without credentials or provider reasoning.
