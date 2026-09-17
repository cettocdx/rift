# Credit operation inspection

Two service-authorized read-only queries now support operator classification:

- `accountCreditInspection:getAccountCreditReservation` loads one exact key,
  including immutable settlement evidence and original source identity.
- `accountCreditInspection:listUnresolvedAccountCreditReservations` lists one
  unsettled state at a time, oldest update first, with a fixed cutoff and opaque
  cursor. Page size is 1–100; database reads are capped at 100 rows and 512 KiB.

Both reject missing, blank or incorrect authority before reading. This authority
is for cross-account operators, not end users. Queue results omit full usage
evidence and digest. Exact evidence must remain in private operator records.
No write, correction, grant, refund, replay endpoint or scheduled job was added.

Root reviewed the code and independently ran all 27 query cases. The broader
143-test matrix, TypeScript, Convex typechecking and scoped lint passed. Fixture
pagination alone does not prove native cursor or index deployment behavior.

Isolated native acceptance subsequently deployed exact
`d3f63dae760e0a571d0ee752ce432b0cb33dec38` to `dev:artful-jaguar-288` with
normal typechecking and confirmed index creation. Seven scenarios passed through
38 read-only queries in 4.109 seconds. Eight exact synthetic records included
three verified terminal digests. Four wrong/empty authority checks rejected.
The in-use queue returned five records across three pages; reconciliation returned
eight across five pages. Exact projections, ordering and fixed cutoff matched.
The reserved queue was empty, so populated reserved pagination was not exercised.
No records, credits, refunds, provider calls or authentication identities changed.

Native evidence: `/tmp/rift-credit-inspection-readonly-c4ba1bf7-4aad-478f-a499-e9f5efd3f699.json`.
SHA-256: `a2b027bcfedcce61cefb2e0d15b18fb05a04a50250a37e783b51ebefebcc8fc0`.
This is live query evidence over synthetic fixtures, not a snapshot, forced OCC,
rollback or ordinary authenticated-user test.

Keep state and cutoff fixed while following `continueCursor` until `isDone`,
including empty intermediate pages. This is a live queue: changing rows can move,
and age alone never proves a process stopped or that a refund is due.

Known persisted settlement evidence can be replayed through the existing
settlement API with its exact original binding and digest. This does not repeat
model work. No such replay tool is supplied here. Missing evidence, immutable
unknown usage and changed source lineage remain unresolved. In particular, do
not use close as a status query or substitute an unrelated admin credit grant
for a keyed correction. A process crash can still lose request-local evidence
and provider responses before persistence.

Reviewed patch: `4b0d7fc9bf38011c1b0d32dc2b0f0e48e12e88e14e611093e5025473e8c7c632`.
Review: `/tmp/rift-credit-inspection-review.md`.
Independent root log: `/tmp/rift-credit-inspection-root-review.log`.
