# CLI streaming update measurement

The previous update loop sanitized and formatted every historical entry on every snapshot. The new loop compares copied primitive field values first, handling both in-place local updates and replacement remote snapshots. Only changed entries are formatted. Detail toggling invalidates the presentation; removed history is destroyed.

Run `pnpm --dir packages/console test:performance` for the OpenTUI native test renderer stress case: 1,000 historical entries of 30 lines, one 1,000-line live entry, 100 updates with 10 warmup samples excluded. This deliberately exceeds the remote wire protocol's 500-entry bound; it is a renderer stress case, not a normal remote payload. The unsent composer draft must remain intact.

| Size   | Before p50 ms | After p50 ms | Before p95 ms | After p95 ms |
| ------ | ------------: | -----------: | ------------: | -----------: |
| 80×24  |          3.71 |         2.82 |          5.18 |         4.50 |
| 126×46 |          3.59 |         3.00 |          4.82 |         8.78 |
| 180×60 |          4.20 |         3.17 |         10.17 |         9.46 |

Single paired runs on the same machine, with the general test suite stopped. Median synchronous update time improved, but tails were inconsistent: the 126×46 after run had a 51.98ms maximum. Visual-idle timing includes renderer scheduling and flush waits; it is not display latency or model time. No claim of consistently faster end-to-end rendering or competitor parity follows from this measurement. PTY/display/input timing under prolonged real output remains an acceptance task.
