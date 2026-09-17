# Media ordering and per-run spending limit

## Changes

| Before | After | Why |
| --- | --- | --- |
| Every run inherited a fixed $5 limit. | No default per-run dollar ceiling. Explicit operator limits, balance funding bounds and independent account allowances remain. | The user explicitly removed the per-run limit; a funded task should not stop at an arbitrary $5. |
| Image/video tool parts were removed from the transcript and appended below all prose. | Both Build and ordinary assistant messages render media in original part order, outside collapsed tool groups. | Later explanations must appear below the media they describe. |
| Media-only output used a separate rendering branch. | The same ordered content path handles media-only and mixed responses. | Avoid moving the image when subsequent text arrives. |

## Verification

- Regression tests reproduced the old behavior: 5 failed, 40 passed before implementation.
- After the fixes: 59 tests passed across run-cost-ceiling, budget-monitor, AssistantTranscript, MessageItem and worked-for-parts suites.
- An integration test continues beyond $5 under the default policy, but aborts after the real prepaid funding bound. Explicit operator ceilings remain tested.
- A DOM identity test confirms the generated-media node remains mounted when later text is appended and streaming finishes.
- TypeScript `pnpm exec tsc --noEmit`: passed after checking the new replay page callbacks.
- Added `/lab/media-order`: local-only replay using the real MessageItem and FilePartRenderer, without model calls or saved messages.
- Actual browser check at 319 px: one media section; its bottom was 437.89 px, later paragraphs began at 449.89 and 526.18 px.
- Actual browser check at 1440 px with panel open: no horizontal overflow; media bottom 475.49 px, subsequent paragraphs at 487.49 and 518.98 px.
- Final loaded-image check: natural width 1280, one media section, later prose below it. Added the missing local SVG fixture also referenced by the existing scroll replay.

## Reference observations and limits

- Inspected the running Cursor Agents accessibility tree: tool results, short commentary and response actions follow chronological order, with separate app tabs. This observation is not a frame-time benchmark.
- Inspected Claude Desktop's current home/compose controls. No task was submitted to Claude or Cursor.
- Opened ChatGPT in Chrome, inspected its composer/sidebar and opened/closed the attachment menu. Sampled navigation text used the system sans-serif stack at 14 px / 20 px / weight 400. ChatGPT web is not the Codex desktop UI; these observations do not establish performance parity.
- Reviewed the provided recording contact sheet; it mainly shows Codex and a narrow RIFT window. The media-hoisting defect was confirmed from source and failing regression tests, not inferred solely from the recording.
- The active Trigger development watcher was left running. New worker versions use the changed default; existing in-flight worker instances may retain their already-constructed ceiling. No task was replayed or cancelled.
- No fresh production bundle or deployment was performed. Checks cover the current 3020 development preview and source, not the older 3022 production preview.
- This change does not claim to eliminate provider/network failures or grant macOS desktop permissions. Long-running generation, real network loss and cross-app frame-time comparisons remain separate verification work.
