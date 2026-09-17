# Startup audit and parallel audit-row preparation

Baseline: three persisted mixed requests against production-built localhost:3020
and development worker 20260914.11. Follow-up: same three scenarios/model/effort
on worker 20260914.13. All six finished and passed scenario checks with no observed
duplicate events. This is not a statistically controlled performance comparison.
Host CPU contention was observed, and the first baseline included a cold web path.

| Scenario    | Before first text ms | After first text ms |
| ----------- | -------------------: | ------------------: |
| Greeting    |                52790 |               15002 |
| Explanation |                16617 |               34075 |
| Terminal    |                27059 |               20481 |

Do not attribute these total changes to this patch. Terminal first text can include
a command and subsequent model step. The four-second target remains unmet.

The baseline audit-row creation was serial after preflight and cost 188–235ms.
It now starts after checkpoint/entitlement/free-lock gates alongside preflight.
It remains awaited before tool construction/model work; pre-model cancellation
also joins pending creation before closing the record, preventing a late-started
row from surviving finalization. No billing or execution authorization was removed.
The after samples show runRecord ending at 2238/3026/1347ms while preflight was
still pending; the separate serial wait is removed, not the database cost itself.

42 focused run-record/billing/cancellation tests passed, including delayed audit
creation on cancellation; TypeScript and scoped ESLint passed. Worker hot reload
was observed at 20260914.13; no shared worker restart was performed.

Evidence: /tmp/rift-startup-before-20260914.json and
/tmp/rift-startup-after-20260914.json. First baseline admission was 29889ms and
worker attempt-to-handler wall-clock delta 20022ms. That delta includes separate
clocks and is not a pure queue timer. The next substantial latency investigation
must isolate web module startup and development-worker startup from provider
latency under controlled host load; do not weaken runtime guards to hide it.

GitHub readiness recheck still returns github_app_not_verified / HTTP404 with
client-ID fingerprint d4d4419af3. User account Confirm access verification is
required to generate/install the new registered app credentials. No secrets were
printed or partial credential pair installed.
