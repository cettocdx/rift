# Evidence and gaps

| Claim | Evidence | Confidence / unresolved gap | Action |
|---|---|---|---|
| Cross-owner run disclosure/cancel | Old route 3/5 regression failures, patched ownership suite passes | Confirmed; not a production exploitation claim | Fixed |
| Run status uncertainty allows duplication | 3/13 liveness regressions before first fix; second pass adds owner-bound atomic Convex claims | 9 real dev transaction race checks passed; no cross-vendor quality benchmark | Fixed uncertainty and atomic admission; see second-pass.md |
| Generic terminal/file/media incorrectly requires web preview | Real SDK scripted-provider loop:3 failures before,29 tests after | Confirmed policy defect; no real model comparative result | Fixed explicit-preview entry contract |
| Stale verification survives edits | Revision and in-flight mutation behavior tests | Rift tool path covered; external/background and native OpenCode edits untracked | Scoped fix, parity next |
| Stop outlives verifier | 2/14 verifier failures before, final suite green | Signal/kill paths tested with doubles; no live E2B stop latency | Fixed local code; live latency pending |
| Agent save/test and login/destination flow | Reproduced component tests; final test submission isolated from previous composer attachments and token limits | No live message or private file sent | Fixed; 35 initial UI tests and 14 late regression tests, overlapping suites |
| Plugins/Skills transition loses focus | Live browser focus fell to WebArea; URL-rerender tests failed for click and ArrowRight | Persistent shared tablist passes 7 tests; post-fix live check blocked by connectivity | Fixed; keyboard-only neutral focus ring added |
| Temporary auth failure erases session cookies | Proxy cleared credentials on every sign-in exception; 6 failing regressions before patch, 9 passing after | Confirmed code defect; observed live auth loss is not proven to have this cause, and theme causality is unproven | Fixed: one refresh-only retry, generic503 preserves credentials, explicit invalidation still signs out |
| Typography matches Cursor pixel-for-pixel | Prior screenshots, current shared CSS and new light-theme home/Studio/Plugins/Skills screenshots | Does not establish exact parity or dark-theme coverage | Keep approved styling; exact parity unverified |
| Entire app visually audited | Route-family inventory, initial browser views; second pass native light/dark home, file picker, Agents tabs, Runs filter, Studio | Still false: sampled native coverage improved; all pages/sizes/states remain unverified | Explicitly exclude full visual claim; see second-pass.md |
| Rift competitive strength score | Runtime contracts and source architecture, vendor docs | Same tasks/model/effort/engine/budget not run across products | Report capability limits; no invented score |
| Preview slowness fully solved by root config | Runtime selected /Users/cetto before fix; now root pinned; warm home HTTP200/0.56s, later cold compile117s | False: root/cache/import changes do not eliminate cold compilation; page HTTP response is not interaction-ready time | Keep warm/cold evidence separate; no speed multiplier |

Sources use primary docs and research. Important exceptions retained: Claude rewind excludes Bash/most subagents; Cursor permissions differ from OS isolation; OpenHands rollout rate is self-comparison; model/harness scores are not interchangeable. A general investigation article or vendor claim is not a guarantee that any particular task will succeed.
