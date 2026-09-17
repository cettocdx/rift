# Full performance acceptance — 2026-09-09

Scope: production frontend, sustained renderer stress, navigation/panel/input continuity, CLI tests, and native desktop walkthrough. Live provider latency is separate from rendering. Competitor native interaction is qualitative unless equivalent timing is available.

## Acceptance targets (declared before runs)
- No lost typed characters, final output, or retained reading position.
- No whole-app fallback when a tool panel loads.
- Warm interaction event p95 <= 100 ms; frame p95 <= 33.4 ms; report every maximum and long task count, not only averages.
- Cold initial loading measured separately; repeat navigation three times where possible.
- At least three sustained mixed/code renderer runs; retain raw measurements.
- Read/scroll during delayed image arrival, panel resize, and output.
- Exercise desktop app navigation, menus, dock and foreground return. Do not equate WebKit automation to native WKWebView measurements.
- Check CLI input/render regression coverage.
- Record unsupported metrics as unavailable, not zero. Record host load and avoid overlapping builds with benchmark runs.

## Inventory
Build composer (typing/effort/model); project and execution selectors; Activity/Preview/Terminal; Plugins/Agents/Tasks/Runs/Artifacts/Studio/Settings; long transcript scrolling; delayed image layout; retained input on navigation; console independent input; foreground/background return. No old run retries or destructive actions.

Execution/reconnection and real model tasks require separate actual task evidence. Tests do not guarantee zero network failures or permanent uptime.
