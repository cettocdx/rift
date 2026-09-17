const { test } = require("node:test");
const assert = require("node:assert/strict");
const modulePromise = import("../dist/local-client.js");
const config = {
  model: "model",
  models: [{ value: "model", label: "Test" }],
  modelEfforts: { model: [{ value: "medium", label: "Medium" }] },
  permissions: [
    { value: "ask", label: "Review first" },
    { value: "auto", label: "Allow edits" },
    { value: "full", label: "Run freely" },
  ],
  targets: [],
};
const response = (messages) =>
  new Response(JSON.stringify({ type: "complete", messages }) + "\n");
const call = (id = "call") => ({
  role: "assistant",
  content: [
    {
      type: "tool-call",
      toolCallId: id,
      toolName: "write_file",
      input: { path: "x", content: "new" },
    },
  ],
});
const wait = async (fn) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > 2000) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
};
test("Stop in a multi-tool step preserves completed tool results and checkpoint", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let saved,
    checkpoint,
    secondStarted = false;
  const first = call("first").content[0];
  const second = call("second").content[0];
  const client = new LocalConsoleClient(
    async (path) =>
      path.endsWith("/config")
        ? Response.json(config)
        : response([{ role: "assistant", content: [first, second] }]),
    "/tmp",
    { id: "multi", messages: [], entries: [] },
    async (s) => {
      saved = s;
    },
    "",
    async (_cwd, _name, _input, signal) => {
      if (!checkpoint) {
        checkpoint = true;
        return "First edit succeeded";
      }
      checkpoint = structuredClone(saved);
      secondStarted = true;
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      signal.throwIfAborted();
    },
  );
  await client.initialize();
  await client.send({ type: "set-approval", value: "full" });
  await client.send({
    type: "submit",
    chatId: "multi",
    text: "Edit two files",
  });
  await wait(() => secondStarted);
  await client.send({ type: "stop", chatId: "multi" });
  const results = saved.messages
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.content);
  assert.equal(
    results.find((r) => r.toolCallId === "first").output.value,
    "First edit succeeded",
  );
  assert.match(
    results.find((r) => r.toolCallId === "second").output.value,
    /Interrupted/,
  );
  assert.ok(
    checkpoint.messages.some(
      (m) =>
        m.role === "tool" && m.content.some((r) => r.toolCallId === "first"),
    ),
  );
  await client.shutdown();
});
test("reopening a partially checkpointed tool batch preserves success without replay", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let saved;
  const client = new LocalConsoleClient(
    async (path) => {
      assert.equal(path, "/api/console/config");
      return Response.json(config);
    },
    "/tmp",
    {
      id: "resume",
      entries: [],
      pending: "local tool execution",
      messages: [
        {
          role: "assistant",
          content: [call("first").content[0], call("second").content[0]],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "first",
              toolName: "write_file",
              output: { type: "text", value: "Saved first" },
            },
          ],
        },
      ],
    },
    async (s) => {
      saved = s;
    },
    "",
    async () => {
      throw new Error("Must not replay");
    },
  );
  await client.initialize();
  const results = saved.messages
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.content);
  assert.equal(results.length, 2);
  assert.equal(results[0].output.value, "Saved first");
  assert.match(results[1].output.value, /unknown/);
  await client.shutdown();
});
test("an interrupted reasoning stream does not leave a permanent Thinking row", async () => {
  const { LocalConsoleClient } = await modulePromise;
  const client = new LocalConsoleClient(
    async (p) =>
      p.endsWith("/config")
        ? Response.json(config)
        : new Response(
            JSON.stringify({ type: "thinking" }) +
              "\n" +
              JSON.stringify({ type: "error", message: "Interrupted" }) +
              "\n",
          ),
    "/tmp",
    { id: "thinking", messages: [], entries: [] },
    async () => {},
  );
  await client.initialize();
  await client.send({ type: "submit", chatId: "thinking", text: "hello" });
  await wait(() => client.snapshot.status === "ready");
  assert.equal(
    client.snapshot.entries.some((e) => e.text === "Thinking…"),
    false,
  );
  assert.ok(client.snapshot.entries.some((e) => e.kind === "error"));
  await client.shutdown();
});
test("local tool waits for explicit approval, persists intent first, and sends real result into next model step", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let step = 0,
    executed = 0;
  const persisted = [];
  const requests = [];
  const c = new LocalConsoleClient(
    async (path, init) => {
      if (path.endsWith("/config")) return Response.json(config);
      requests.push(JSON.parse(init.body));
      return response(
        ++step === 1
          ? [call()]
          : [{ role: "assistant", content: [{ type: "text", text: "Done" }] }],
      );
    },
    "/tmp",
    { id: "own", messages: [], entries: [] },
    async (s) => persisted.push(s),
    "",
    async () => {
      assert.equal(persisted.at(-1).pending, "local tool execution");
      executed++;
      return "Wrote x";
    },
  );
  await c.initialize();
  await c.send({ type: "submit", chatId: "own", text: "Edit" });
  await wait(() => c.snapshot.approvals.length);
  assert.equal(executed, 0);
  await c.send({ type: "approve", chatId: "own", id: "call", approve: true });
  await wait(() => c.snapshot.status === "ready");
  assert.equal(executed, 1);
  assert.equal(step, 2);
  assert.equal(requests[1].messages.at(-1).content[0].output.value, "Wrote x");
  assert.equal(persisted.at(-1).pending, undefined);
  await c.shutdown();
});
test("denial and Stop while awaiting approval never execute the file operation", async () => {
  const { LocalConsoleClient } = await modulePromise;
  for (const stop of [false, true]) {
    let executed = 0,
      step = 0;
    let saved;
    const c = new LocalConsoleClient(
      async (p) =>
        p.endsWith("/config")
          ? Response.json(config)
          : response(
              ++step === 1
                ? [call()]
                : [{ role: "assistant", content: "Denied" }],
            ),
      "/tmp",
      { id: "own", messages: [], entries: [] },
      async (state) => {
        saved = state;
      },
      "",
      async () => {
        executed++;
        return "bad";
      },
    );
    await c.initialize();
    await c.send({ type: "submit", chatId: "own", text: "Edit" });
    await wait(() => c.snapshot.approvals.length);
    await c.send(
      stop
        ? { type: "stop", chatId: "own" }
        : { type: "approve", chatId: "own", id: "call", approve: false },
    );
    await wait(() => c.snapshot.status === "ready");
    assert.equal(executed, 0);
    assert.ok(
      saved.messages.every((m) => m.role !== "tool" || m.content.length > 0),
    );
    await c.shutdown();
  }
});
test("interrupted local action is marked uncertain on reopen and never replayed", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let saved;
  let executions = 0;
  const c = new LocalConsoleClient(
    async (p) => {
      assert.equal(p, "/api/console/config");
      return Response.json(config);
    },
    "/tmp",
    {
      id: "own",
      messages: [call()],
      entries: [],
      pending: "local tool execution",
    },
    async (s) => (saved = s),
    "",
    async () => {
      executions++;
      return "";
    },
  );
  await c.initialize();
  assert.equal(executions, 0);
  assert.match(saved.messages.at(-1).content[0].output.value, /unknown/);
  assert.match(c.snapshot.entries[0].text, /No command was replayed/);
  await c.shutdown();
});
test("truncated model stream is not automatically retried and no tools run", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let requests = 0,
    executed = 0;
  const c = new LocalConsoleClient(
    async (p) => {
      if (p.endsWith("/config")) return Response.json(config);
      requests++;
      return new Response(
        JSON.stringify({ type: "text", text: "partial" }) + "\n",
      );
    },
    "/tmp",
    { id: "own", messages: [], entries: [] },
    async () => {},
    "",
    async () => {
      executed++;
      return "";
    },
  );
  await c.initialize();
  await c.send({ type: "submit", chatId: "own", text: "Edit" });
  await wait(() => c.snapshot.status === "ready");
  assert.equal(requests, 1);
  assert.equal(executed, 0);
  assert.match(c.snapshot.entries.at(-1).text, /interrupted/);
  await c.shutdown();
});

test("a malformed live model stream is canceled without replay or local execution", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let canceled = 0,
    executed = 0,
    requested = 0;
  const client = new LocalConsoleClient(
    async (path) => {
      if (path.endsWith("/config")) return Response.json(config);
      requested++;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("invalid-json\n"));
          },
          cancel() {
            canceled++;
          },
        }),
      );
    },
    "/tmp",
    { id: "malformed", messages: [], entries: [] },
    async () => {},
    "",
    async () => {
      executed++;
      return "unexpected";
    },
  );
  await client.initialize();
  await client.send({ type: "submit", chatId: "malformed", text: "inspect" });
  await wait(() => client.snapshot.status === "ready");
  assert.equal(canceled, 1);
  assert.equal(requested, 1);
  assert.equal(executed, 0);
  assert.ok(client.snapshot.entries.some((entry) => entry.kind === "error"));
  await client.shutdown();
});

test("duplicate call identities are rejected before any local side effect", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let executed = 0,
    saved;
  const client = new LocalConsoleClient(
    async (path) =>
      path.endsWith("/config")
        ? Response.json(config)
        : response([
            {
              role: "assistant",
              content: [
                call("duplicate").content[0],
                call("duplicate").content[0],
              ],
            },
          ]),
    "/tmp",
    { id: "duplicate", messages: [], entries: [] },
    async (s) => {
      saved = s;
    },
    "",
    async () => {
      executed++;
      return "ok";
    },
  );
  await client.initialize();
  await client.send({ type: "set-approval", value: "full" });
  await client.send({ type: "submit", chatId: "duplicate", text: "Edit" });
  await wait(() => client.snapshot.status === "ready");
  assert.equal(executed, 0);
  assert.match(saved.entries.at(-1).text, /duplicate/i);
  await client.shutdown();
});

test("repeated failing tools use the app's progress guard instead of spending 80 model calls", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let requests = 0,
    saved;
  const instructions = [];
  const client = new LocalConsoleClient(
    async (path, options) => {
      if (path.endsWith("/config")) return Response.json(config);
      instructions.push(JSON.parse(options.body).instructions);
      return response([call(`loop-${++requests}`)]);
    },
    "/tmp",
    { id: "loop", messages: [], entries: [] },
    async (s) => {
      saved = s;
    },
    "",
    async () => {
      throw new Error("Tool unavailable");
    },
  );
  await client.initialize();
  await client.send({ type: "set-approval", value: "full" });
  await client.send({ type: "submit", chatId: "loop", text: "Edit" });
  await wait(() => client.snapshot.status === "ready");
  assert.equal(requests, 5);
  assert.ok(instructions[3].length > instructions[0].length);
  assert.match(saved.entries.at(-1).text, /progress|repeated/i);
  await client.shutdown();
});

test("a changed read result is progress, even when the file path is unchanged", async () => {
  const { detectDoomLoop } = await import("../dist/harness-progress.js");
  const steps = Array.from({ length: 6 }, (_, i) => ({
    toolCalls: [{ toolName: "read_file", input: { path: "build.log" } }],
    toolResults: [
      {
        toolName: "read_file",
        output: { type: "text", value: `progress ${i}` },
      },
    ],
  }));
  assert.equal(detectDoomLoop(steps).severity, "none");
});

test("reopening an interrupted model-only step resumes the saved task without adding another user message", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let requests = 0,
    saved;
  const c = new LocalConsoleClient(
    async (p) =>
      p.endsWith("/config")
        ? Response.json(config)
        : (requests++, response([{ role: "assistant", content: "Recovered" }])),
    "/tmp",
    {
      id: "recover-model",
      messages: [{ role: "user", content: "Inspect the project" }],
      entries: [],
      pending: "model response",
      model: "model",
    },
    async (s) => {
      saved = s;
    },
    "",
    async () => {
      throw new Error("Unexpected tool");
    },
  );
  await c.initialize();
  await wait(() => c.snapshot.status === "ready");
  assert.equal(requests, 1);
  assert.equal(saved.messages.filter((m) => m.role === "user").length, 1);
  assert.equal(saved.pending, undefined);
  assert.equal(saved.messages.at(-1).content, "Recovered");
  await c.shutdown();
});

test("reopening an interrupted read resumes reasoning but does not blindly replay the old call", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let requestMessages,
    executions = 0;
  const c = new LocalConsoleClient(
    async (p, options) =>
      p.endsWith("/config")
        ? Response.json(config)
        : ((requestMessages = JSON.parse(options.body).messages),
          response([{ role: "assistant", content: "Recovered" }])),
    "/tmp",
    {
      id: "recover-read",
      messages: [
        { role: "user", content: "Inspect" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "read-old",
              toolName: "read_file",
              input: { path: "x" },
            },
          ],
        },
      ],
      entries: [],
      pending: "local tool execution",
      model: "model",
    },
    async () => {},
    "",
    async () => {
      executions++;
      return "content";
    },
  );
  await c.initialize();
  await wait(() => c.snapshot.status === "ready");
  assert.ok(requestMessages);
  assert.equal(executions, 0);
  assert.match(
    requestMessages.at(-1).content[0].output.value,
    /read.*interrupted/i,
  );
  await c.shutdown();
});

for (const scenario of [
  {
    name: "explicitly stopped",
    pending: undefined,
    model: "model",
    messages: [{ role: "user", content: "Inspect" }],
  },
  {
    name: "retired model",
    pending: "model response",
    model: "retired",
    messages: [{ role: "user", content: "Inspect" }],
  },
  {
    name: "uncertain write",
    pending: "local tool execution",
    model: "model",
    messages: [{ role: "user", content: "Edit" }, call("uncertain-write")],
  },
]) {
  test(`reopening an ${scenario.name} session does not start a model request`, async () => {
    const { LocalConsoleClient } = await modulePromise;
    const c = new LocalConsoleClient(
      async (p) => {
        assert.equal(p, "/api/console/config");
        return Response.json(config);
      },
      "/tmp",
      { id: "no-resume", entries: [], ...scenario },
      async () => {},
    );
    await c.initialize();
    assert.equal(c.snapshot.status, "ready");
    await c.shutdown();
  });
}

test("local reasoning deltas remain visible before the final answer", async () => {
  const { LocalConsoleClient } = await modulePromise;
  const events = [
    { type: "thinking" },
    { type: "reasoning", text: "Checking " },
    { type: "reasoning", text: "the request." },
    { type: "text", text: "Hello" },
    { type: "complete", messages: [{ role: "assistant", content: "Hello" }] },
  ];
  const client = new LocalConsoleClient(async path => path.endsWith("/config")
    ? Response.json(config) : new Response(events.map(e => JSON.stringify(e) + "\n").join("")),
    "/tmp", { id: "reasoning", messages: [], entries: [] }, async () => {}, "");
  await client.initialize();
  await client.send({ type: "submit", chatId: "reasoning", text: "hello" });
  await wait(() => client.snapshot.status === "ready");
  const entries = client.snapshot.entries;
  assert.equal(entries.find(e => e.id.endsWith(":reasoning")).text, "Checking the request.");
  assert.ok(entries.findIndex(e => e.id.endsWith(":reasoning")) < entries.findIndex(e => e.kind === "assistant"));
  assert.equal(entries.some(e => e.id.endsWith(":thinking")), false);
  await client.shutdown();
});

test("structured questions wait for an explicit answer and never execute in the shell", async () => {
  const { LocalConsoleClient } = await modulePromise;
  let requests = 0, executions = 0;
  const client = new LocalConsoleClient(async path => path.endsWith("/config") ? Response.json(config) : response(++requests === 1
    ? [{role: "assistant", content: [{type:"tool-call",toolCallId:"q1",toolName:"ask_question",input:{title:"Choose the output",options:["Web", "CLI"]}}]}]
    : [{role:"assistant",content:"Continuing with CLI"}]), "/tmp", {id:"q",messages:[],entries:[]}, async()=>{}, "", async()=>{ executions++; return "Unexpected"; });
  await client.initialize();
  await client.send({type:"submit",chatId:"q",text:"Build an app"});
  await wait(()=>client.snapshot.questions?.length);
  assert.equal(requests,1);
  assert.equal(client.snapshot.approvals.length,0);
  await assert.rejects(client.send({type:"answer",chatId:"q",id:"stale",text:"Web"}),/expired/);
  await client.send({type:"answer",chatId:"q",id:"q1",text:"CLI"});
  await wait(()=>client.snapshot.status==="ready");
  assert.equal(requests,2);
  assert.equal(executions,0);
  assert.ok(client.snapshot.entries.some(e=>e.kind==="user"&&e.text==="CLI"));
  assert.equal(client.snapshot.questions.length,0);
  await client.shutdown();
});
test("Stop releases a pending structured question", async () => {
 const { LocalConsoleClient }=await modulePromise;
 const client=new LocalConsoleClient(async path=>path.endsWith('/config')?Response.json(config):response([{role:'assistant',content:[{type:'tool-call',toolCallId:'q1',toolName:'ask_question',input:{title:'Which?',options:['A','B']}}]}]),'/tmp',{id:'stopq',messages:[],entries:[]},async()=>{},'');
 await client.initialize(); await client.send({type:'submit',chatId:'stopq',text:'Choose'}); await wait(()=>client.snapshot.questions?.length);
 await client.send({type:'stop',chatId:'stopq'}); assert.equal(client.snapshot.questions.length,0); assert.equal(client.snapshot.status,'ready'); await client.shutdown();
});
