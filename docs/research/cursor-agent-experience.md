# Cursor agent experience and RIFT implementation requirements

## Findings

RIFT has durable main-agent execution, a native desktop shell, persisted conversation recovery, lazy tool loading and an increasingly coherent workbench. These are useful foundations, but they do not establish equivalence with Cursor. The strongest confirmed architectural differences are the scope and lifetime of delegated work, and the distinction between execution checkpoints and recoverable file snapshots. Visual differences must be assessed separately from those execution contracts.

Cursor describes its harness as an evolving, model-specific product evaluated through experiments and real usage, not a universal prompt that makes every model behave identically. Its publicly described approach supports changing the harness as model capabilities change. Reproducing a fixed list of prompts or controls would therefore be a poor acceptance criterion. RIFT needs measurable task outcomes, context efficiency, recoverability and usable review workflows.[1]

The reference installation inspected is Cursor 3.20.10 at `/Applications/Cursor.app`. Documentation was checked on September 12, 2026. Public documentation, installed client assets, observed UI state and RIFT implementation evidence are separate evidence classes. None provides access to Cursor's private server implementation, exact prompts, private evaluation set or scheduling algorithms.

## Reference experience

The current Cursor Agents accessibility tree exposes a repository-oriented sidebar, per-repository task history, task completion and PR state, a focused conversation, a compact composer, branch/environment/context information and separate panel groups. The inspected conversation has PR, Changes, Desktop, Browser and a file tab in the upper group, plus an independent terminal below. This supports a workspace that keeps conversation and inspectable artifacts adjacent without turning every artifact into another message.

The visible screenshot also shows a compact change summary immediately above the composer. The source of truth for that summary must be the actual work being reviewed. A conversation's edited-file receipt, a working tree's current diff and a pull request's diff are different datasets; an interface should not substitute one for another merely because all three can show green and red numbers.

The current inspection successfully read Cursor's accessibility tree and screenshot. Attempts to activate Changes subsequently returned computer-control errors (`noWindowsAvailable` and stale element IDs), including after resolving the installed app separately from a mounted installer copy. Those failed actions are not evidence that Cursor's own Changes feature is broken, and are not counted as successful interaction tests. Previous screenshots supplied with the task show the intended file-list and panel-navigation appearance, but do not prove every command's behavior.

## Harness and tool execution

Cursor's documented subagent system provides separate contexts and supports specialized work, background operation, resumption and isolation options.[2] RIFT's `lib/ai/tools/delegate-task.ts` currently implements bounded research/review delegates. Its description explicitly excludes editing, commands, artifact upload, MCP use and further delegation. Calls are awaited, and the inspected schema has no resume identifier or foreground/background mode. Current limits include six steps, twelve tool calls and ninety seconds.

This is a real capability gap, not a naming issue. Removing those limits or passing every parent tool to a child would not implement the missing behavior. A writable child needs an execution identity, a scoped workspace, parent-derived authorization, its own cancellation and usage receipts, and a merge/review boundary. Otherwise two apparently independent agents can modify the same file or duplicate charges when one reconnects.

The recommended implementation is to reuse RIFT's existing durable execution infrastructure for children rather than introduce another in-memory promise registry. Each child should have a parent run ID, child run ID, user/project ownership, selected profile, explicit task, isolated workspace identity, checkpoint cursor, result manifest, usage receipts and terminal status. The parent should be able to keep working while observing children. Resumption should attach to the same execution or continue a verified checkpoint; it must not silently replay unresolved writes.

This is an implementation recommendation for RIFT, not a claim about Cursor's private schema. Isolation and authorization must be tested with two concurrent children, parent cancellation, an expired connection, and a child that tries to escape its assigned workspace. The UI should display the real child state and result, including a failed check, rather than simulate agent activity.

## Context discovery and cost

Cursor publicly describes writing large tool responses to files, exposing historical conversation content after summarization, loading skills and MCP descriptions as needed, and making integrated terminal history discoverable. Its reported token reduction is a product-specific experiment; it cannot be applied as an assumed RIFT saving.[3]

RIFT already has long-output storage in `lib/ai/tools/utils/terminal-output-saver.ts` and archive handling in `lib/chat/compaction/prune-tool-outputs.ts`. The outstanding question is not simply whether an archive exists. The agent must be able to locate and read the omitted information when it becomes relevant, after compaction and after a restart, using tools actually exposed in that run.

A subsequent code trace confirmed a narrower storage-recovery defect: `lib/chat/chat-processor.ts` removes `isRunArchive` file parts before attachment processing. In addition, ordinary sandbox attachment collection only considers the last user message. An archive attached to an assistant message therefore cannot become a readable sandbox file through that path. This does not negate the separate summarization implementation, which already writes searchable transcript files and supplies their paths. The fix must preserve registered archive identifiers through owner-scoped URL refresh and materialize them without automatically injecting their JSON contents into model context. The on-demand `read_run_archive` implementation now resolves current owner/chat membership, refreshes storage URLs and exposes bounded historical excerpts. It does not add historical blobs to initial sandbox setup.

A representative validation should place a unique required fact in the middle of a large command result, another in early conversation history, then force context compaction. The agent must retrieve both facts with their originating evidence, and use them to finish a task. Passing a unit test that merely finds an archive filename is insufficient. Measure total input, cached input, output/reasoning usage, tool-output bytes, number of compactions and final task correctness. Repeat with different providers because context and cache behavior may differ.

Cost acceptance should use cost per successfully completed task, not only cost per request. A cheaper first attempt that loses state and repeats work can cost more overall. Failed provider requests, delegate usage, retries and refunds need separate receipts linked to a stable execution identity. Existing RIFT accounting should be preserved and tested before changing provider routing.

## Checkpoints, recovery and final answers

Cursor documents checkpoint-based file recovery in an agent session.[4] RIFT's `lib/agent/checkpoint.ts` currently validates and serializes closed model/tool history. That is execution recovery state; it does not, by itself, restore edited, created or deleted files. The two capabilities must remain distinct in both implementation and UI wording.

File recovery should capture prior content and identity for files changed by the agent. Before restoring, compare current content with the content last written by the agent so intervening manual edits are not overwritten silently. Recovery should preview the affected paths and preserve the conversation. A real acceptance test must cover creation, deletion, rename, binary content, simultaneous manual changes and restoration failure, verifying hashes on disk rather than a toast.

The recent observed RIFT Build failure was an S2 upload timeout: three attempts, a five-second request timeout, four records and 51,216 bytes. The source model stream and its delivery mirror were coupled through fail-fast waiting. The implemented correction waits for model consumption and persistence, classifies only the observed transport timeout, and preserves actual source failures. A separate completed-worker marker allows the client to finish only when the worker reports a successful outcome. Cancellation and handled rate-limit states do not qualify.

That correction is supported by focused tests, stream-branch fault injection and a full passing suite. It is not proof against every outage. Required remaining live scenarios include an upload failure during a long command, app backgrounding, app restart, delayed metadata, interrupted persistence, cancellation during reconnection and loss of the final delivery frame. Verify that the final answer is complete, task state settles, work is not repeated and billing is not duplicated.

## Workbench and review

RIFT's conversation Changes component and its repository Git component should not be conflated. The former can accurately show recorded agent edits and inline diffs. The latter must bind to a specific repository on the selected Local or Cloud environment. A repository control must never silently create a cloud sandbox when the task is local.

The target workbench contract includes stable tabs, preserved scroll positions, keyboard navigation, independent terminal lifetime, actual file opening, current repository changes, explicit staged/unstaged state, hunk review, branch information and available PR actions. Controls whose backend behavior is not implemented should not appear as functioning equivalents. Opening a panel should not remount the conversation or reset the message viewport.

Before enabling write operations, verify the selected repository path, ownership and environment. Stage/unstage, commit, restore and push are distinct actions. Test both local and cloud repositories, nested repositories, untracked files, deleted files and a directory with no repository. The pending Git initialization correction addresses the no-repository path; it is not a replacement for environment routing and full review integration.

## Typography, material and motion

Installed Cursor client assets and earlier native captures provide concrete design evidence. The existing material audit records separate root, sidebar and main-pane contributions. A dark native sample measured Cursor sidebar RGB 35 and empty chat RGB 26; the corresponding updated RIFT sample measured 35 and 25. This is a close match for that sample, not a guarantee across wallpapers or compositors. Electron and WKWebView native material results cannot be inferred solely from identical CSS alpha values.

RIFT's existing audit uses the platform system font and records primary, secondary, tertiary and icon roles separately. The correct comparison includes font family, size, weight, line height, truncation, baseline alignment and contrast on the composited surface. Renaming a font or making every text node the same gray would not establish consistency. Review light/dark themes, high contrast, reduced transparency and reduced motion independently.

Motion acceptance should measure input-to-next-paint and frame stalls under representative output, rather than simply adding transitions. Panel resizing, opening a diff, switching chats, expanding a tool result and typing while output streams are distinct workloads. Keep the viewport and machine conditions fixed, warm both applications, record cold-start separately and avoid benchmarking while a production build saturates the machine.

## Mobile acceptance

Desktop similarity must not produce a cramped desktop layout on a phone. The mobile contract is a readable conversation, a composer that remains reachable above the keyboard, clear task status, accessible attachment and model controls, and deliberate full-screen or sheet presentations for tools and artifacts. A task should continue when a panel closes; closing a sheet is not cancellation.

Test narrow and wide phones, portrait/landscape, dynamic viewport changes, safe-area insets, long model names, uploaded media, error recovery and a long transcript. Validate focus return and keyboard operation, not just screenshots. A mobile browser test cannot establish native iOS behavior; label evidence by platform and engine.

## Current browser regression evidence

The full transcript fixture matrix completed with 64 passing cases and 16 intentionally skipped platform-inapplicable cases (`/tmp/rift-transcript-complete.log`). It covers Chromium and WebKit at 360, 390 and 430 pixel phone widths and desktop configurations. Checks include reading anchors through media insertion, code output and reflow, following after keyboard-sized resize, route return and code-fence completion. The desktop-only real dock cases passed; they are deliberately skipped on phones, while phone-only retained-transcript cases are skipped on desktop.

These are browser fixture integration checks, not a live provider outage campaign or proof of native iOS/desktop parity. They establish specific scroll and reflow behavior under the fixture workload. They do not establish that all mobile product flows, all panel actions or the entire agent harness are complete.

The chat-shell matrix additionally passed 52 cases with four platform-inapplicable skips. Its checks cover question and draft actions at reduced heights, simulated keyboard viewport resizing and preservation of rejected answers for retry. This remains fixture evidence rather than hardware-keyboard or native iOS certification.

A live storage round trip then saved a 1,200,256-byte assistant message, verified automatic compaction and archive registration, and recovered a unique fact through the new tool using a refreshed storage URL. The returned excerpt was 200 characters and no model call was used. The reproducible script is `scripts/verify-agent-archive-recovery.ts`; the result is `docs/qa/2026-09-12-archive-recovery/live.json`. This proves the real storage/tool retrieval boundary, not that every model autonomously chooses retrieval after every kind of context compaction. Current tool limits include an 8 MiB archive body cap, a 12,000-character excerpt cap and repeated download of the selected archive on subsequent reads; caching and larger-archive streaming remain future work.

## Acceptance register

| Area                      | Required proof                                                                 | Current classification                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Main-run upload failure   | Live long task survives transport failure with one final result and one charge | Local fault tests passed; live campaign pending                                                                    |
| Durable children          | Two independently running children survive reload and can be resumed by ID     | Implementation gap                                                                                                 |
| Writable children         | Isolated edits and real checks can be reviewed and integrated                  | Implementation gap                                                                                                 |
| File checkpoints          | Restore actual file hashes without losing unrelated manual edits               | Implementation gap                                                                                                 |
| Context retrieval         | Exact archived facts recovered after forced compaction/restart                 | On-demand fix and live stored-archive sentinel recovery passed; full model-led compaction/restart campaign pending |
| Changes panel             | Correct repository/environment and working Git actions                         | Partial implementation; integration pending                                                                        |
| Native materials          | Matched captures across light/dark and accessibility modes                     | One dark sample close; broader comparison pending                                                                  |
| Interactive performance   | Comparable representative workloads with latency/frame distributions           | Parity unproven                                                                                                    |
| Mobile usage              | Keyboard, navigation, streaming and recovery tested on phone layouts           | Full acceptance campaign pending                                                                                   |
| Final product equivalence | All above outcomes plus feature inventory exercised                            | Not established                                                                                                    |

## Implementation order

First complete the interrupted-run live campaign and archive-retrieval validation. Then introduce durable child execution, followed by isolated writable children and reviewed integration. Implement file recovery as a separate feature. In parallel, finish real repository binding in the workbench and expand native/mobile interaction measurements. Styling changes should be checked against captured reference states; architectural changes should be checked against task outcomes and cost.

The eventual landing page should only demonstrate capabilities that pass these acceptance checks. Its product examples must be genuine recorded results, not simulated claims of autonomous operation or unverified performance equivalence.

## Sources

1. Cursor, “Continually improving our agent harness,” April 30, 2026. https://cursor.com/blog/continually-improving-agent-harness
2. Cursor Docs, “Subagents,” accessed September 12, 2026. https://cursor.com/docs/subagents
3. Jediah Katz, Cursor, “Dynamic context discovery,” January 6, 2026. https://cursor.com/blog/dynamic-context-discovery
4. Cursor Docs, “Agent overview,” accessed September 12, 2026. https://cursor.com/docs/agent/overview
5. Cursor 3.20.10 installed client, `/Applications/Cursor.app/Contents/Resources/app/package.json`; current native screenshot and accessibility observation. Private local reference, no public URL.
6. RIFT source: `lib/ai/tools/delegate-task.ts`, `lib/agent/checkpoint.ts`, `lib/chat/compaction/prune-tool-outputs.ts`, `lib/ai/tools/utils/terminal-output-saver.ts`, `lib/chat/agent-long-transport.ts`, `trigger/agent-long.ts`.
7. RIFT local verification notes: `docs/release/2026-09-12-native-surface-reference.md`, `docs/release/2026-09-12-agents-material-audit.md`. Native sample claims are limited to the conditions documented there.
