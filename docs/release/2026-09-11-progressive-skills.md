# Progressive enabled skill loading

Build turns now advertise a compact manifest for 14 reviewed, unchanged catalog presets and load their full instructions through `find_skills({task, skill_ids})` when applicable. The web route and durable worker share the same owner-scoped enabled-skill snapshot with both the injector and tool factory, including provider fallback rebuilds.

Explicit request selections, customized/unknown/global skills, the managed bot roster, ambiguous catalog IDs and unaudited presets remain fully injected. `og-share-card` remains eager because its broad unprompted trigger is not represented by its description. Caller paths without a shared snapshot remain eager. Security and Studio instructions retain their existing path.

Exact-ID loading returns stored instructions once per ID, reports missing/ambiguous/out-of-scope IDs, and never installs or refreshes account settings in either Agent or Plan. Task-only discovery remains backward compatible. Self-contained explanations no longer receive a blanket instruction to run discovery first. Applicable implementation still requires relevant playbooks.

## Verification and limits

Focused tests cover snapshot stability, explicit/custom/roster retention, scope, schema bounds, Plan read-only behavior, manifest-to-loader correspondence, and unchanged other-purpose prompts. Thirteen new integration tests and 24 prompt snapshot cases passed; only 8 Build snapshots changed. Final full-suite results are recorded with the release commit.

A synthetic seven-preset + roster fixture reduced the last-user reminder from 5,414 to 1,865 estimated tokens (65.6%). This is not a provider receipt or whole-run cost result. Live task measurements are separately recorded under `/Users/cetto/RIFT-Reports`.

Semantic pack selection remains model-guided, not a hard gate. New account changes are observed on a new turn, not by mutating an active run's snapshot. Task-only discovery remains anchored to the authoritative request. The existing checkpoint barrier conservatively classifies find_skills as an effect because the discovery branch can persist; exact read-only loads also cross that marker. No checkpoint/approval policy was relaxed.
