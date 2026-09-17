const { test } = require("node:test");
const assert = require("node:assert/strict");
const config = {
  defaultModel: "gpt-5.4",
  models: [
    {
      id: "gpt-5.4",
      label: "GPT",
      providerModel: "gpt-5.4",
      efforts: ["medium"],
    },
  ],
};
async function fixture() {
  const { NativeConsoleClient } = await import("../dist/native-client.js");
  const sent = [];
  const c = new NativeConsoleClient({
    send: async (m) => {
      sent.push(m);
      if (m.method === "thread/start")
        queueMicrotask(() =>
          c.receive({
            id: m.id,
            result: { thread: { id: "thread", turns: [] } },
          }),
        );
    },
    config,
    workspace: "/work",
  });
  return { c, sent };
}
test("duplicate submit prevented, stop before start interrupts eventual turn, stale deltas rejected", async () => {
  const { c, sent } = await fixture();
  const first = c.command({ type: "submit", text: "hello", chatId: null });
  assert.equal(
    (await c.command({ type: "submit", text: "again", chatId: null })).accepted,
    false,
  );
  assert.equal(
    (await c.command({ type: "submit", text: "third", chatId: null })).accepted,
    false,
  );
  await c.command({ type: "stop", chatId: null });
  await new Promise((r) => setImmediate(r));
  const start = sent.find((m) => m.method === "turn/start");
  c.receive({
    method: "turn/started",
    params: {
      threadId: "thread",
      turn: { id: "turn", status: "inProgress", items: [] },
    },
  });
  c.receive({ id: start.id, result: { turn: { id: "turn" } } });
  await first;
  assert.equal(sent.filter((m) => m.method === "turn/interrupt").length, 1);
  c.receive({
    method: "item/agentMessage/delta",
    params: {
      threadId: "other",
      turnId: "turn",
      itemId: "bad",
      delta: "secret",
    },
  });
  assert.ok(!c.snapshot.entries.some((e) => e.text === "secret"));
  c.dispose();
});
test("denial preserves request ID; multiple answers aggregate; private reasoning ignored", async () => {
  const { c, sent } = await fixture();
  c.restore({
    id: "thread",
    turns: [{ id: "turn", status: "inProgress", items: [] }],
  });
  c.receive({
    id: 42,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread", turnId: "turn", command: "pwd" },
  });
  await c.command({
    type: "approve",
    id: "42",
    approve: false,
    chatId: "thread",
  });
  assert.deepEqual(sent.at(-1), { id: 42, result: { decision: "decline" } });
  c.receive({
    id: 43,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      questions: [
        { id: "a", question: "A?" },
        { id: "b", question: "B?" },
      ],
    },
  });
  const qs = c.snapshot.questions;
  await c.command({
    type: "answer",
    id: qs[0].id,
    text: "one",
    chatId: "thread",
  });
  assert.equal(sent.length, 1);
  await c.command({
    type: "answer",
    id: qs[1].id,
    text: "two",
    chatId: "thread",
  });
  assert.deepEqual(sent.at(-1), {
    id: 43,
    result: { answers: { a: { answers: ["one"] }, b: { answers: ["two"] } } },
  });
  c.receive({
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: {
        type: "reasoning",
        id: "r",
        content: ["PRIVATE"],
        summary: ["Public"],
      },
    },
  });
  assert.ok(!JSON.stringify(c.snapshot).includes("PRIVATE"));
  c.dispose();
});

test("unsupported question request and native failure remain errors without fallback", async () => {
  const { c, sent } = await fixture();
  c.restore({
    id: "thread",
    turns: [{ id: "turn", status: "inProgress", items: [] }],
  });
  c.receive({
    id: 10,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      questions: Array.from({ length: 4 }, (_, i) => ({
        id: String(i),
        question: "Q",
      })),
    },
  });
  assert.equal(c.snapshot.status, "error");
  assert.equal(
    (await c.command({ type: "submit", text: "retry", chatId: "thread" }))
      .accepted,
    false,
  );
  assert.equal(sent.length, 0);
  c.dispose();
});

test("native settings reject cross-setting values", async () => {
  const { c } = await fixture();
  assert.equal(
    (await c.command({ type: "set-target", value: "ask" })).accepted,
    false,
  );
  assert.equal(
    (await c.command({ type: "set-mode", value: "agent" })).accepted,
    true,
  );
  c.dispose();
});

test("resolved request replay removes approvals and partial questions in the active turn", async () => {
  const { c, sent } = await fixture();
  c.restore({
    id: "thread",
    turns: [{ id: "turn", status: "inProgress", items: [] }],
  });
  const approval = {
    id: 10,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread", turnId: "turn", command: "pwd" },
  };
  const question = {
    id: 11,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      questions: [
        { id: "a", question: "A?" },
        { id: "b", question: "B?" },
      ],
    },
  };
  c.receive(approval);
  c.receive(question);
  await c.command({
    type: "answer",
    chatId: "thread",
    id: "11:a",
    text: "partial",
  });
  for (const requestId of [10, 11])
    c.receive({
      method: "serverRequest/resolved",
      params: { threadId: "thread", requestId },
    });
  assert.equal(c.snapshot.approvals.length, 0);
  assert.equal(c.snapshot.questions.length, 0);
  c.reconcileRequests([approval, question]);
  assert.equal(c.snapshot.approvals.length, 0);
  assert.equal(c.snapshot.questions.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(c.snapshot.status, "streaming");
  c.dispose();
});
test("authoritative outstanding request reconciliation removes expired controls", async () => {
  const { c } = await fixture();
  c.restore({
    id: "thread",
    turns: [{ id: "turn", status: "inProgress", items: [] }],
  });
  c.receive({
    id: 12,
    method: "item/fileChange/requestApproval",
    params: { threadId: "thread", turnId: "turn" },
  });
  assert.equal(c.snapshot.approvals.length, 1);
  c.reconcileRequests([]);
  assert.equal(c.snapshot.approvals.length, 0);
  c.dispose();
});

for (const approve of [true, false])
  test(`MCP empty form tool confirmation ${approve ? "accepts once" : "declines"} without persistence`, async () => {
    const { c, sent } = await fixture();
    c.restore({
      id: "thread",
      turns: [{ id: "turn", status: "inProgress", items: [] }],
    });
    const raw = require("./fixtures/native-mcp-approval.json")[0];
    const request = {
      ...raw,
      params: { ...raw.params, threadId: "thread", turnId: "turn" },
    };
    c.receive(request);
    assert.equal(c.snapshot.approvals.length, 1);
    assert.match(c.snapshot.approvals[0].preview, /fixture/);
    assert.match(c.snapshot.approvals[0].preview, /echo/);
    assert.match(c.snapshot.approvals[0].preview, /MCP_NATIVE_OK/);
    assert.equal(
      (await c.command({ type: "approve", id: "0", approve, chatId: "thread" }))
        .accepted,
      true,
    );
    assert.deepEqual(sent.at(-1), {
      id: 0,
      result: {
        action: approve ? "accept" : "decline",
        content: approve ? {} : null,
        _meta: null,
      },
    });
    c.receive(request);
    assert.equal(c.snapshot.approvals.length, 0);
    assert.equal(sent.length, 1);
    c.dispose();
  });
for (const variant of ["nonempty", "url", "unmarked"])
  test(`MCP ${variant} elicitation stays explicitly unsupported`, async () => {
    const { c, sent } = await fixture();
    c.restore({
      id: "thread",
      turns: [{ id: "turn", status: "inProgress", items: [] }],
    });
    const raw = require("./fixtures/native-mcp-approval.json")[0];
    const params = { ...raw.params, threadId: "thread", turnId: "turn" };
    if (variant === "nonempty")
      params.requestedSchema = {
        type: "object",
        properties: { secret: { type: "string" } },
      };
    if (variant === "url") params.mode = "url";
    if (variant === "unmarked") params._meta = {};
    c.receive({ ...raw, params });
    assert.equal(c.snapshot.status, "error");
    assert.match(c.snapshot.entries.at(-1).text, /Unsupported.*MCP/);
    assert.match(c.snapshot.entries.at(-1).text, /Disconnect/);
    assert.equal(sent.length, 0);
    c.dispose();
  });

for (const kind of ["approval", "answer"])
  test(`uncertain ${kind} delivery fails closed without replay`, async () => {
    const { NativeConsoleClient } = await import("../dist/native-client.js");
    let sends = 0;
    const c = new NativeConsoleClient({
      config,
      workspace: "/work",
      send: async () => {
        sends++;
        throw new Error("transport lost after native accepted bytes");
      },
    });
    c.restore({
      id: "thread",
      turns: [{ id: "turn", status: "inProgress", items: [] }],
    });
    const request =
      kind === "approval"
        ? {
            id: 30,
            method: "item/fileChange/requestApproval",
            params: { threadId: "thread", turnId: "turn" },
          }
        : {
            id: 30,
            method: "item/tool/requestUserInput",
            params: {
              threadId: "thread",
              turnId: "turn",
              questions: [{ id: "q", question: "Which?" }],
            },
          };
    c.receive(request);
    const command =
      kind === "approval"
        ? { type: "approve", id: "30", approve: true, chatId: "thread" }
        : { type: "answer", id: "30:q", text: "Yes", chatId: "thread" };
    assert.equal((await c.command(command)).accepted, false);
    assert.equal(c.snapshot.status, "error");
    assert.match(c.snapshot.entries.at(-1).text, /delivery is uncertain/);
    assert.match(c.snapshot.entries.at(-1).text, /Disconnect/);
    c.receive(request);
    assert.equal((await c.command(command)).accepted, false);
    assert.equal(sends, 1);
    c.dispose();
  });
test("new conversation ignores old thread replay and adopts only its next submitted thread", async () => {
  const { c, sent } = await fixture();
  c.restore({ id: "old-thread", turns: [] });
  await c.command({ type: "new-chat" });
  c.receive({
    method: "thread/started",
    params: { thread: { id: "old-thread" } },
  });
  assert.equal(c.snapshot.chatId, null);
  const submit = c.command({ type: "submit", text: "new input", chatId: null });
  await new Promise((r) => setImmediate(r));
  const turn = sent.find((m) => m.method === "turn/start");
  assert.equal(turn.params.threadId, "thread");
  c.receive({ id: turn.id, result: { turn: { id: "new-turn" } } });
  await submit;
  assert.equal(c.snapshot.chatId, "thread");
  c.dispose();
});

test("idle and unchanged authoritative polls preserve snapshot identity without publication", async () => {
  const { c } = await fixture();
  c.restore({
    id: "thread",
    turns: [{ id: "turn", status: "inProgress", items: [] }],
  });
  let publications = 0;
  c.subscribe(() => publications++);
  const idle = c.snapshot;
  for (let i = 0; i < 20; i++) c.reconcileRequests([]);
  assert.equal(publications, 0);
  assert.equal(c.snapshot, idle);
  const request = {
    id: 100,
    method: "item/fileChange/requestApproval",
    params: { threadId: "thread", turnId: "turn" },
  };
  c.reconcileRequests([request]);
  assert.equal(publications, 1);
  const pending = c.snapshot;
  for (let i = 0; i < 20; i++) c.reconcileRequests([request]);
  assert.equal(publications, 1);
  assert.equal(c.snapshot, pending);
  c.reconcileRequests([]);
  assert.equal(publications, 2);
  assert.equal(c.snapshot.approvals.length, 0);
  const resolved = c.snapshot;
  for (let i = 0; i < 20; i++) {
    c.reconcileRequests([request]);
    c.receive({
      method: "serverRequest/resolved",
      params: { threadId: "thread", requestId: 100 },
    });
  }
  assert.equal(publications, 2);
  assert.equal(c.snapshot, resolved);
  c.fail(new Error("offline"));
  const failed = c.snapshot;
  const count = publications;
  for (let i = 0; i < 20; i++) c.reconcileRequests([]);
  assert.equal(publications, count);
  assert.equal(c.snapshot, failed);
  c.dispose();
});
test("ignored native notifications do not publish snapshots", async () => {
  const { c } = await fixture();
  c.restore({
    id: "thread",
    turns: [{ id: "turn", status: "inProgress", items: [] }],
  });
  let publications = 0;
  c.subscribe(() => publications++);
  const original = c.snapshot;
  for (let i = 0; i < 20; i++) {
    c.receive({
      method: "thread/status/changed",
      params: { threadId: "thread", status: { type: "active" } },
    });
    c.receive({
      method: "item/reasoning/textDelta",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "private",
        delta: "private",
      },
    });
    c.receive({
      method: "item/started",
      params: {
        threadId: "thread",
        turnId: "turn",
        item: {
          id: "private",
          type: "reasoning",
          summary: [],
          content: ["private"],
        },
      },
    });
  }
  assert.equal(publications, 0);
  assert.equal(c.snapshot, original);
  c.dispose();
});
