# Credit reservation live concurrency — 2026-09-11

The inactive primitives from `d3186a5` were deployed to the separate regional
Convex development deployment `artful-jaguar-288` with typechecking enabled.
No current user, shared deployment, or payment/provider integration was used.

Fifteen scenarios passed in 13.579 seconds, issuing 142 requests through 142
distinct `ConvexHttpClient` instances. Separate clients matter because sharing
one client would serialize its mutations before the server receives them.
Fifteen randomly named synthetic ledger owners were retained for inspection.

- Eight simultaneous reserves of one identity charged once and returned the
  same receipt. Four distinct identities of equal value charged four times.
- A mixed-source debit used 50 included and 50 purchased points. After the
  consumer deliberately discarded the successful response, the same identity
  replayed its receipt and close restored both sources exactly once.
- Both ordered reserve/close boundaries passed. Three concurrent reserve/close
  trials finished closed with no outstanding debit.
- Eight simultaneous start-use requests produced exactly one fresh grant.
- Three close/start-use races closed without a fresh late grant.
- Downgrade/clamp, upgrade-back, and same-cycle revoke/regrant invalidated old
  receipt lineage. Close reported unresolved, left balances unchanged, and
  further admission was denied.

All observed concurrent reserve/close and close/start-use races chose close
first. The test does not claim both race winners, forced internal conflict retry,
transaction rollback fault injection, or exactly-once external execution. The
discarded response is consumer-side fault simulation after a confirmed commit,
not a deliberately interrupted TCP response. Readback used the existing
service-authenticated balance query rather than direct table inspection.

Evidence:

- `/tmp/rift-credit-occ-2c9fd9dd-cba3-42e3-843a-e58b45885e4a.json`, SHA-256
  `4f5ac381ea2a5a1663829882e52900ff66c230b6a85362e9ad56c93a3326f599`.
- `/tmp/rift-credit-occ.cjs`, SHA-256
  `49fde5f2edbbb06ca8dce8237610929a2ff1bd0ee2bbce5e8663ebe1abc9acff`.

The harness restricted the exact regional HTTPS host, denied redirects, bounded
requests and duration, generated all owners internally, and used only the fresh
isolated service key. It never submitted a model request or changed a real
user's credit balance. Source deployment was verified separately; the accounting
APIs themselves do not attest a Git revision.

These results validate the backend building block. Caller activation, terminal
usage settlement, ordinary user authentication, crash reconciliation, and the
original live response-loss defect remain separate gates.
