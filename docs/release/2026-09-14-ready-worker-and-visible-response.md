# Ready-worker startup and visible response check

Three persisted build-codex/medium baseline tasks completed and verified with no duplicate events. Evidence `/tmp/rift-ready-baseline.json`: greeting first text 8729 ms, explanation 18986 ms, terminal 32649 ms (terminal text can follow tool execution). Ready workers do not establish under-four-second latency. Explanation ownership wait alone was 6130 ms despite unqueued admission; queue removal is not sufficient to explain all variability.

Project authorization now starts alongside history/customization/skills/balance reads using the owner/run-bound activation snapshot already used by history loading. It remains freshly revalidated against backend project state and joined before execution. This removes the previous history-then-project serial dependency without changing the selected model, effort, or authorization checks. Worker hot reload observed at 20260914.23. No new web bundle required for this worker-only change. No post-change project-specific latency result is claimed.

28 project/authority/preparation tests passed. TypeScript and scoped ESLint passed. Separately, 28 auto-resume/real-SDK/replay tests passed.

Native RIFT UI Preview manual check: created a fresh chat and submitted an explicit no-tools visible-answer test with the existing GPT-5.6 Sol/High UI selection. Chat c571ac46-b36c-4c82-a618-c669500e09d5 rendered one RIFT_GORUNUM_TAMAM response, completed state and disabled send button for the empty composer. A later accessibility observation was unchanged, with no return to Working observed. This is not frame-by-frame proof against every transient flicker. UI reported Worked for 23s; do not compare this High-effort UI task directly to Medium benchmark TTFT.

Chrome's unauthenticated home loaded the landing page; no credentials were inserted. UI verification used the already-authenticated installed desktop app. Host inspection showed substantial concurrent CPU consumers; no applications were stopped and no causal attribution is made from that snapshot. Overall latency objective remains open.
