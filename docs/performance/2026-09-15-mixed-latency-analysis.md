# Mixed workload latency — exploratory live trace

Three temporary chats used build-codex at medium effort against development
origin 3046 while a separate 20-minute terminal continuity run was active.
One sample per category is diagnostic, not an SLO or isolated benchmark.

| Scenario              | First visible text | Admission | Worker first text |
| --------------------- | -----------------: | --------: | ----------------: |
| Greeting              |          12,654 ms |  4,692 ms |          4,678 ms |
| Tool-free explanation |          30,375 ms |  3,153 ms |         25,314 ms |
| One terminal command  |          34,004 ms |  see JSON |         30,050 ms |

All three scenario verifiers and explicit worker cleanup checks passed. The
terminal's first executable tool input arrived at 20,735 ms. Final text for a
tool task includes execution and the post-tool model round; it is not TTFT.

Explanation first prepare completed at worker +23,854 ms; first model chunk/text
arrived at +25,314 ms. Thus only 1,460 ms of that worker latency followed initial
preparation. Skills read was 17,192 ms, entitlement 16,820 ms, balance 7,272 ms,
history 2,458 ms. These overlap: summing them would invent a critical path.
The next investigation must trace shared backend/network waits and dependency
ordering rather than attribute this sample to slow model reasoning.

Greeting provider input contained 3,667 system characters, 11,657 user-category
characters, zero tools, two messages. Explanation likewise had zero tools but
11,986 user-category characters. These are serialized sizes, not billable tokens.
The skills injector receives the standalone flag but explicitly treats it as
legacy metadata; its progressive loading retains managed-roster guidance.
An older selectEnabledSkillsForTurn filter exists but is not used by that path.
Do not simply drop user custom skills/roster instructions to improve the count;
review semantic requirements and explicit-selection handling before a change.

Evidence: adjacent mixed-latency-current.json and mixed-prompt-current.json.
The sub-four-second objective is not met in this trace. No new savings claimed.
