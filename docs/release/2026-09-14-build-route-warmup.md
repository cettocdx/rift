# Preview Build route cold-load warmup

The local preview launcher now requests GET /api/agent-long on loopback after
starting Next. This route has no GET handler, so 405 confirms that Next has loaded
it without admitting a task, reading a request body or invoking a model. No user
credentials are attached, redirects are forbidden, and server exit aborts the
bounded preparation. This is module preparation, not a model/worker heartbeat.
It does not eliminate model TTFT or warm-request admission cost.

Observed before launcher activation: a first GET timed out at 15 seconds while
the root page remained responsive; a subsequent GET returned 405 in 0.671s.
This is consistent with cold route loading, not a controlled attribution of the
entire delay to import evaluation. Host contention remains uncontrolled.

Four unit/config checks passed, covering destination restriction, GET-only/no
payload/no credentials, retry before listening, redirect rejection and abortion
on shutdown. Scoped lint passed. Preview web was reloaded only after an idle
inventory (328 released claims, no active HTTP/chat streams).

The initial 30-second preparation budget expired on the fresh server, whose
reported startup itself took 9.4 seconds. A subsequent route GET returned 405 in
0.0806s. Budget is now 60 seconds, still bounded and nonblocking; the revised
launcher budget needs the next service start to take effect. No claim is made
that a user submitting before preparation completes avoids the cold wait.

Current live mixed benchmark: /tmp/rift-startup-warm-route-20260914.json.
A separate Cursor crash-reporting process repeatedly consumed 169–189% CPU.
Permission to terminate that process for a controlled comparison was requested;
it was not terminated without the user's answer. Do not equate CPU observations
with proof that this process accounts for all RIFT latency.

Live results (three exploratory samples, not a cold/warm controlled SLO):

- greeting: first text 7507ms; admission 2189ms; verified true; duplicates 0.
- explanation: first text 8326ms; admission 2437ms; verified true; duplicates 0.
- terminal: first text 18192ms; admission 1885ms; verified true; duplicates 0.
  Four-second target remains unmet.

The 60-second budget launcher was subsequently activated after a fresh idle gate.
The server logged `[preview] Build route warmup: ready`; a follow-up loopback GET
returned 405 in 0.0295 seconds. This confirms the preparation path runs on start,
not a four-second end-to-end model response guarantee.
