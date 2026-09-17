# Activity history selection

The native preview showed an empty Activity panel after a follow-up failed before tools started, despite earlier commands in the transcript. The current-run boundary is intentional and must remain intact.

The panel now defaults to Latest message and offers explicit earlier user-message selection. Selected history is sliced at the next user message, commands are reconstructed from persisted tool parts, and sourced plans are filtered to that slice. Unattributed legacy plans are not assigned to historical turns. The selector is shared by desktop and mobile Activity.

Historical inspection uses ready display status, does not create or resume tasks, and hides new-subagent creation. Returning to Latest message restores the live display. Command selection uses the existing detail-navigation callback. Current counters never include previous messages.

Alternatives rejected: mixing all conversation operations into the live counters would obscure current progress; replacing the empty label alone would leave prior work inaccessible in Activity.

Regression covers a live current turn, earlier command output and navigation, old-plan isolation, and return to the live phase. Before implementation the history selector assertion failed. Three focused suites passed (67 tests), with TypeScript passing. Full release gate and native visual acceptance must be recorded separately; this is not evidence of full product parity or reliable task execution.
