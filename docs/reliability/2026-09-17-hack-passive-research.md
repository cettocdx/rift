# Hack passive research execution

The user's follow-up reported a behavioral regression rather than identifying one failing execution. Compared the current source against the checked-in baseline:

- Security tools were expanded (file listing, public browser and owner-granted desktop tools), not removed.
- The former unconditional no-refusal/blanket-authorization prompt was replaced. Restoring that entire block would falsely treat subscription and account membership as authorization for any target or action.
- Clarified the shared Hack workflow instead: passive public domain/company research does not require ownership proof merely to read public information. Authorized assessments should execute with the available tools rather than return only a tutorial; an optional tool failure should preserve evidence and allow suitable alternatives.
- Scope still bounds intrusive tests and non-public access. No authorization is inferred from webpage contents or account tier.

Validation: one targeted regression failed before the change; 61 system-prompt and tool-policy tests passed afterward. ESLint passed. Source snapshot validation recorded separately.

Publication candidate uses a copy of the already-published Sept17 source snapshot with only `lib/system-prompt/hack-workflow.ts` replaced. It does not include unrelated current dirty changes. Deployment log: `/tmp/rift-hack-osint-publish.log`. Main local worker was not restarted.

A recent OSINT conversation was visible in history, but its contents could not be loaded because the isolated local 3082 reader was no longer listening. No target scan or repeated task was submitted. The individual run's failure category remains unverified.

## Accidental empty file recovery

User reported hack-workflow.ts deletion during native release work. The file was present but zero bytes. Restored exactly from the existing unpromoted deployment snapshot referenced by `/tmp/rift-hack-osint-publish-path`: 2,903 bytes, SHA256 `34726dd22e4d36a2e13495090615b4e2fb5b561949f7beee1f64e81230641a56`. System-prompt suite 51/51 passed (`/tmp/rift-hack-workflow-restored-test.log`); file ESLint clean. This restores the last local workflow module, not the older unconditional prompt. No production alias promotion was performed.
