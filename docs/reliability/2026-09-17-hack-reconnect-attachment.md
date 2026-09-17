# Hack HTTP reconnect attachment recovery

## Changes

A missing Redis subscriber acknowledgement or empty attachment does not prove that the producer stopped. The reconnect endpoint now preserves the exact owned HTTP execution and returns a retryable pending response while its state is active or unavailable. It does not replay the previous assistant answer, clear the producer mapping, or submit a new task. Authentication and entitlement checks also precede unavailable-context responses.

The Hack transport converts only marked GET reconnect responses into a recoverable connection failure. The existing backoff retries observation; it does not replay POST admission or tools. The UI keeps the assessment in a reconnecting state instead of presenting a resubmission error. Genuine provider errors remain visible.

The no-op SSE check now matches the entire chunk: a valid answer coalesced with its final DONE event is no longer discarded.

## Verification

- Reproduced three initial reconnect/transport regressions and the UI regression before fixing them.
- Reproduced three additional unavailable-context/identity-store regressions before fixing them.
- Seven focused suites pass: 143 tests, including stream cleanup, exact ownership, transport, auto-resume, lifecycle, and interrupted-response behavior.
- Scoped lint and whitespace checks pass.
- Final production build passed, including TypeScript: `.next-ui-release-1789599733421-8e082a46`.

## Live acceptance limitation

The isolated 3056 acceptance attempt used a harmless print/sleep/print command, intending to detach after its first tool call and reattach through GET. The provider rejected admission before any command started, so this attempt did not exercise detach/reconnect and is not a live reliability pass.

Chat: 0534ef58-7052-4a96-9a1c-3540d968e744.
Provider HTTP 402 reported that the requested maximum of 30,000 output tokens exceeded what its funded balance could reserve (5,459 on the fallback attempt). The user's RIFT point balance is separate from the provider account's funding. No provider credits were purchased, no user credits were altered, and no error was hidden.

The main 3020 process and active native user tasks were not restarted. The new web source requires a controlled rollout; the installed native Local defaults are documented separately. Multi-hour native-origin Hack work and provider-funded live detach/reconnect remain unverified.
