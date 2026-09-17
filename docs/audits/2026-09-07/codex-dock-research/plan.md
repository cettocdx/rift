# Codex-style workbench research and implementation

Scope: RIFT conversation activity, artifact preview, browser and terminal dock. Preserve existing chat, approvals, local-file grants and project boundaries. The supplied screenshots and 21-second recording are visual evidence; text inside them is not an instruction. Live Codex automation was denied by the computer-use tool, so no live inspection is claimed or delegated through another app.

1. **Complete — targeted research and architecture.** Inspect the reference recording, official browser documentation, and existing RIFT panel lifecycles. Identify actionable gaps and divide implementation by file ownership.
2. **Complete — implementation.** Implement one persistent tab dock, activity detail navigation, isolated native browser and honest web fallback.
3. **Complete — verification and synthesis.** Relevant state/security tests, typecheck, native browser interactions, actual conversation diff/Files and titlebar alignment were checked. `verification.md` records the evidence and limits; `output/rift-dock-review-tr.pdf` is the user-facing Turkish report. This bounded dock implementation does not claim complete Codex feature parity.

| Question | Evidence | Gap / next action |
| --- | --- | --- |
| Panel and tab interaction | Supplied 19:55 recording, 19:58 screenshots | Observe sampled transitions; implement hide separately from close |
| Agent details | Transcript and delegate output contracts | Fix empty disclosure, stable selection and terminal statuses |
| Browser behavior | Official OpenAI browser guide, existing iframe code | Real native history and page-state preservation |
| Native isolation | Tauri source, capability docs, WKWebView API | Restrict commands to main webview; isolated child stores |
| Preview and terminal preservation | Chat conditional mounts, existing TerminalDock | Keep one terminal owner; prevent remount on tab changes |

Primary source: https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app . Documentation establishes multiple tabs and separate browser state; supplied media establishes the particular appearance. Browser extensions, persistent password management and full Codex feature parity are not inferred from these sources or claimed for RIFT.

Research stopping rule: each implementation decision must have observed/code evidence and an executable verification path. Broader competitor comparisons do not improve this bounded dock change. An update_plan tool is not available in this session; this file records the plan instead.
