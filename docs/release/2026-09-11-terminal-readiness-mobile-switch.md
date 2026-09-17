# Native readiness and mobile Settings controls

Source: `/Users/cetto/RIFT-Release`, release-candidate branch, following
`9edf9d5`. This is a bounded acceptance record, not whole-product release approval.

## Terminal readiness

Durable Unix terminals now wait for descriptor readiness rather than retrying
empty reads and blocked writes every 5 ms. An independently owned CLOEXEC master
descriptor and a sticky cancellation socket let close/revoke wake both reader and
writer without consuming each other's signal. Partial-write offsets, bounded
output credit, UTF-8 drain before EOF, and retained child status are preserved.
Attaching to stopped output reports Closed immediately. Legacy/non-Unix paths
are unchanged. Independent review found no concrete blocker.

Native tests: **67 passed**, including idle readiness wait counts, cancellation
of two simultaneous waiters, cancellation before ready data, buffered UTF-8/HUP,
stopped reattachment and descriptor release. Native production build and signature
verification passed. The installed `/Applications/RIFT UI Preview.app` executable
SHA-256 is
`7d1e77e34849de6cae7f6c68dee1aae16d616ac9c0bcd1814964e8f0b9473612`.
This is ad-hoc signed, not Apple-notarized.

### Installed observations

- Native PID 86810, shell PID 87070, working directory `/Users/cetto`.
- `seq 1 120000` reached the last row and ready prompt. No precise render-time
  claim is derived from this manual observation.
- Cmd+R during an eight-iteration, two-second timestamp command retained all
  eight timestamps (1789086092 through 1789086106), Connected state and the same
  shell process. `printenv RIFT_READINESS_PROBE` returned `retained` afterwards.
- Bounded replay explicitly disclosed trimmed history.
- `exit 7` displayed Exited 7. Reload kept that state, with no respawn, and OS
  inspection confirmed the old shell process gone. Explicit Restart created
  shell PID 88236; closing that idle shell removed it rather than leaving a
  reader-waiting process behind.

### Idle process measurements

Read-only `proc_pid_rusage` sampling, one idle shell, ten seconds per sample.
These counters cover the native process, not the whole WebKit process tree.

| Version            | Interrupt wakeups/sec | CPU, percent of one core | Physical footprint |
| ------------------ | --------------------: | -----------------------: | -----------------: |
| Before, one sample |               196.996 |                    0.016 |       45,253,712 B |
| After, sample 1    |               146.024 |                   0.0390 |       43,566,160 B |
| After, sample 2    |               131.633 |                   0.0395 |       43,566,160 B |
| After, sample 3    |               149.523 |                   0.0417 |       43,566,160 B |

The three new samples retained exactly one unchanged shell PID. Wakeups decreased
in this observation, but CPU did not; do not present this as a general latency or
CPU improvement. Kernel-attributed wakeups are not exact loop counts. The old
baseline is a single sample, not an alternating controlled benchmark. The 25 ms
child-status watcher still exists. Multi-terminal, prolonged and full-process-tree
energy/performance measurement remains open.

## Shared Switch touch area

The actual button is now 44 by 44 pixels for coarse pointers, while its visible
track remains 32 by 18.4. It reserves layout space instead of overlapping nearby
buttons with an invisible halo. Fine-pointer geometry is unchanged. Radix state,
disabled behavior, label activation and keyboard focus are retained.

**28 browser cases passed, zero skipped**, using real production components and
CSS with fixture services: Chromium/WebKit, 360/390/430 widths, coarse/fine input,
desktop, and 844/500 heights. Assertions include hit testing at the padding edges,
exactly one change callback, thumb/color changes, disabled controls and adjacent
compact-footer actions. Existing affected tests: 17 passed. Independent review
found no concrete blocker. Report:
`e2e/mobile-fixture/results/switch/report.json`; preserved execution report:
`/tmp/rift-switch-complete-2026-09-11T00-18-13.859Z.json`.

Production web build passed; the restarted 3020 service returned HTTP 200. The
real authenticated General Settings screen at 390 by 844 loaded the new nested
track, preserved the existing enabled setting, and stayed 390 pixels wide. This
manual browser is fine-pointer: its unchanged 32 by 18.4 control is expected.
No real account preference was changed for this check.

## Broader mobile inspection and open gates

The real signed-in browser was manually navigated through General, Appearance,
Workbench/terminal, Agents/permissions, API keys, Privacy, Billing, Keyboard and
Account settings at 390 by 844. The command palette was opened/dismissed. No
billing, API-key, account, privacy or runner action was submitted. No document
horizontal overflow was observed. This revealed other compact action controls;
their coarse-pointer audit is a separate follow-up.

The authenticated 132-case automated acceptance suite still lacks the required
authorized storage-state fixture. Component-fixture passes and manual navigation
do not replace that gate or physical-device testing. Long agent tasks, competitor
parity, desktop consent, production worker promotion, signed distribution and
landing redesign remain outside this batch's proof.

Build/test logs: `/tmp/rift-readiness-native-tests.log`,
`/tmp/rift-readiness-native-build.log`,
`/tmp/rift-readiness-switch-web-build.log`. Idle samples:
`/tmp/rift-readiness-idle-1.json` through `-3.json`.
