# Recover terminal workers before effects permission

A protocol-v1 worker could die before entry or before its effects marker and
leave cleanup pending indefinitely. Previously terminal observation retained
that fence even though this protocol required an irreversible marker before
work could begin.

The terminal receipt transaction now distinguishes these cases. For a
cleanup-required v1 receipt with no effects marker, it closes entry/permission,
records no-effects cleanup and releases only the matching claim and chat
mapping. Marker writes and terminal reconciliation read/write the same row:
permission winning first retains the remote fence; reconciliation winning first
prevents late permission or entry. Legacy and effects-started workers still
require independent remote-exit confirmation.

Repeated exact terminal evidence can repair an older pending no-effects receipt.
The server refresh helper submits already-persisted terminal evidence for that
repair without treating a failed provider lookup as terminality. The backend
checks ownership, claim, run and unchanged terminal status. Successor claims and
mappings remain unchanged, including on repeated delivery.

Focused verification passed 1,122 tests across 79 suites. New failures were
reproduced before implementation. Coverage includes death before/after entry,
late effects rejection, effects-before-death fencing, legacy receipt fencing,
repeat delivery and successor isolation. Existing remote-cleanup fixtures now
explicitly obtain effects permission when testing a worker that ran tools.

These are deterministic transaction-handler tests, not hosted process-death or
concurrent database transaction measurements. Durable Hack rollout remains off
pending hosted acceptance. This reconciles execution ownership only, not paid
reservations, usage settlement or automatic refunds.
