# Invalid cwd lock and native session repair

## Confirmed causes

The OPEN STUDIO run was canceled but retained an active claim because its remote drain rejected with InvalidArgumentError. One foreground reservation remained reserved: the requested cwd was the very directory the command intended to create. Six other foreground resources had exited. The missing supervisor receipt was not treated as exit proof.

The native session test reproduced Keychain status -34018 with CODE_SIGNING_ALLOWED=NO. Enabling simulator ad-hoc signing and generating test target Info.plists made the same persistence test pass.

## Changes and verification

- Foreground journaled commands resolve cwd inside the supervised child, not before the supervisor starts. A missing directory now yields exit code 1 and a real descendant-reaping receipt. Original commands are never retried automatically.
- 46 terminal tests pass, including missing cwd cleanup; TypeScript passes. A real owned E2B sandbox check returned exit 1, state exited and descendantsReaped true.
- Historical run recovery verified the canceled producer and exact claim/resource ownership, sealed its launch directory under the supervisor lock, and invoked a denied empty supervisor. Its own exit-125 receipt was persisted before cleanup confirmation and claim release. No original command was replayed, files deleted, or pending state blindly cleared.
- The local worker loaded the updated source (20260914.27).
- iOS session persistence now passes with signing enabled. README documents the requirement. Simulator app reinstalled with signing enabled.
- Native model selection now uses bundled provider vector marks and a compact selected-model label. Unknown providers retain a generic symbol.

## Limits

This repairs the observed missing-cwd reservation failure, not every possible network or provider outage. The repaired historical task was not automatically rerun. Live iOS account login awaits the user entering credentials again; credentials were not retained. Native integration test verifies a synthetic session across service recreation, not authenticated model completion.
