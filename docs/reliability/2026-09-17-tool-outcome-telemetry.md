# Tool outcome telemetry correction — 17 September 2026

## Observed defect

An owned, completed production run (`run_06gaq15h8i5gv9ajtalh3ga301`)
contained two terminal results with exit codes 127 and 2 and one legacy MCP
result beginning `Tool error:`. Its metrics reported 41 tool calls and zero
tool errors. This contradicted the persisted tool evidence; it did not mean
that the final task failed or that all three errors shared a cause.

The instrumentation inspected only direct `exitCode`, `error`, `ok`, and
`success` properties. `run_terminal_cmd` returns a `result` envelope. MCP
also uses `isError` and historically returned a `Tool error:` string.

## Change

- Inspect `result` and `result.exited` only for `run_terminal_cmd`.
- Recognize MCP `isError` and the legacy error string for MCP tool names.
- Identify explicitly unconfirmed terminal/MCP outcomes separately from
  known failures. Events retain `ok: false` with `error_class: unconfirmed`;
  aggregates expose additive `tool_unconfirmed` and per-tool `unconfirmed`
  counts. `tool_errors` counts known failures. Old metrics without the new
  fields remain readable.
- Preserve background-start receipts, successful stdout containing error
  words, and nested example data returned by file tools.
- Preserve the exact tool return value and execute it once. No retry,
  content logging, task cancellation, or recursive payload inspection is added.

## Verification

Before the fix, 9 regression tests failed. After the fix, 98 tests across
instrumentation, terminal execution, MCP capabilities, and MCP credential
handling passed. Repository TypeScript and scoped ESLint checks passed.
An instrumentation-to-run-metrics test confirms three known failures and one
unconfirmed outcome in six calls, including unchanged return identities and
no diagnostic content in emitted events.

Evidence logs:

- `/tmp/rift-tool-outcome-red.log`
- `/tmp/rift-tool-outcome-regression.log`
- `/tmp/rift-tool-outcome-types.log`

## Delivery boundary

This is a source correction. Use by the running worker has not been verified.
Historical run metrics were not rewritten. This fixes measurement, not the
underlying missing executable, compiler diagnostic, or remote MCP failure.
It is not evidence that mobile Safari, long tasks, or provider availability
are universally reliable. Carry this change into the next verified worker
release and confirm the new fields on a controlled run without replaying a
user's existing commands.
