const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket } = require("ws");
const { snapshot } = require("./fixture.cjs");
const load = import("../dist/session.js");

async function setup(t, extra = {}) {
  const { createConsoleSession } = await load;
  const session = await createConsoleSession({
    appUrl: "http://localhost:3020",
    cwd: "/tmp/test-rift",
    ...extra,
  });
  t.after(() => session.close());
  const secret = new URL(session.pairingUrl).hash.split(":").at(-1);
  function connect(options = {}) {
    return new WebSocket(
      `ws://127.0.0.1:${session.port}/console`,
      ["rift-console-v1", `rift-${secret}`],
      { origin: "http://localhost:3020", ...options },
    );
  }
  async function attached() {
    const socket = connect();
    const greeting = once(socket, "message");
    await once(socket, "open");
    assert.equal(JSON.parse((await greeting)[0]).type, "connected");
    const published = once(session.events, "snapshot");
    socket.send(JSON.stringify({ type: "snapshot", snapshot: snapshot() }));
    await published;
    return socket;
  }
  return { session, secret, connect, attached };
}

test("app URL restricts credentials, fragments and insecure nonlocal origins", async () => {
  const { validateAppUrl } = await load;
  assert.equal(
    validateAppUrl("https://riftsys.app").origin,
    "https://riftsys.app",
  );
  assert.equal(validateAppUrl("http://localhost:3020").port, "3020");
  for (const url of [
    "http://evil.test",
    "file:///tmp/a",
    "https://u:p@riftsys.app",
    "https://riftsys.app/#token",
  ])
    assert.throws(() => validateAppUrl(url));
});
test("rejects wrong origin before upgrade and accepts only one authenticated app", async (t) => {
  const { connect, attached } = await setup(t);
  const invalid = connect({ origin: "https://evil.test" });
  const [error] = await once(invalid, "error");
  assert.match(error.message, /403/);
  await attached();
  const duplicate = connect();
  const [conflict] = await once(duplicate, "error");
  assert.match(conflict.message, /409/);
});
test("rejects missing or incorrect capability even from expected app origin", async (t) => {
  const { session } = await setup(t);
  const invalid = new WebSocket(
    `ws://127.0.0.1:${session.port}/console`,
    ["rift-console-v1", "rift-wrong"],
    { origin: "http://localhost:3020" },
  );
  const [error] = await once(invalid, "error");
  assert.match(error.message, /403/);
});
test("rejects a rebinding Host despite a correct capability and Origin", async (t) => {
  const { connect } = await setup(t);
  const invalid = connect({ headers: { Host: "attacker.example" } });
  const [error] = await once(invalid, "error");
  assert.match(error.message, /403/);
});
test("paired unavailable session may create a conversation but cannot submit", async (t) => {
  const { session, attached } = await setup(t);
  const socket = await attached();
  const published = once(session.events, "snapshot");
  socket.send(
    JSON.stringify({
      type: "snapshot",
      snapshot: { ...snapshot(), status: "unavailable" },
    }),
  );
  await published;
  await assert.rejects(
    session.send({ type: "submit", text: "Hello", chatId: "chat-one" }),
    /Connect/,
  );
  const incoming = once(socket, "message");
  const action = session.send({ type: "new-chat" });
  const message = JSON.parse((await incoming)[0]);
  socket.send(
    JSON.stringify({ type: "result", id: message.id, accepted: true }),
  );
  await action;
});
test("requires validated snapshot and waits for matching action acknowledgement", async (t) => {
  const { session, attached } = await setup(t);
  await assert.rejects(session.send({ type: "new-chat" }), /Connect/);
  const socket = await attached();
  const incoming = once(socket, "message");
  let resolved = false;
  const action = session
    .send({ type: "submit", text: "Hello RIFT", chatId: "chat-one" })
    .then(() => {
      resolved = true;
    });
  const command = JSON.parse((await incoming)[0]);
  assert.equal(command.command.text, "Hello RIFT");
  assert.equal(resolved, false);
  socket.send(
    JSON.stringify({ type: "result", id: command.id, accepted: true }),
  );
  await action;
  assert.equal(resolved, true);
});
test("rejects stale conversation, unknown settings and missing approval ids", async (t) => {
  const { session, attached } = await setup(t);
  await attached();
  await assert.rejects(
    session.send({ type: "stop", chatId: "old-chat" }),
    /conversation changed/,
  );
  await assert.rejects(
    session.send({ type: "set-model", value: "imaginary-model" }),
    /not available/,
  );
  await assert.rejects(
    session.send({
      type: "approve",
      chatId: "chat-one",
      id: "gone",
      approve: true,
    }),
    /no longer pending/,
  );
});
test("pending approvals travel only as explicit scoped decisions", async (t) => {
  const { session, attached } = await setup(t);
  const socket = await attached();
  const incoming = once(socket, "message");
  const action = session.send({
    type: "approve",
    chatId: "chat-one",
    id: "approval-one",
    approve: false,
  });
  const message = JSON.parse((await incoming)[0]);
  assert.deepEqual(message.command, {
    type: "approve",
    chatId: "chat-one",
    id: "approval-one",
    approve: false,
  });
  socket.send(
    JSON.stringify({ type: "result", id: message.id, accepted: true }),
  );
  await action;
});
test("disconnect rejects uncertain write and reconnect never resends it", async (t) => {
  const { session, attached } = await setup(t);
  const socket = await attached();
  const incoming = once(socket, "message");
  const action = session.send({
    type: "submit",
    text: "Build it",
    chatId: "chat-one",
  });
  const rejected = assert.rejects(
    action,
    (error) => error.uncertain && /may have reached/.test(error.message),
  );
  await incoming;
  const disconnected = once(session.events, "disconnected");
  socket.terminate();
  await disconnected;
  await rejected;
  assert.equal(session.snapshot, null);
  const replacement = await attached();
  const messages = [];
  replacement.on("message", (data) => messages.push(JSON.parse(data)));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(messages, []);
});
test("acknowledgement timeout is uncertain and does not retry", async (t) => {
  const { session, attached } = await setup(t, { requestTimeoutMs: 25 });
  const socket = await attached();
  let messages = 0;
  socket.on("message", () => messages++);
  await assert.rejects(
    session.send({ type: "new-chat" }),
    (error) => error.uncertain === true,
  );
  assert.equal(messages, 1);
});
test("invalid payload terminates connection and cannot update snapshot", async (t) => {
  const { session, attached } = await setup(t);
  const socket = await attached();
  const closing = once(socket, "close");
  const disconnected = once(session.events, "disconnected");
  socket.send(
    JSON.stringify({ type: "snapshot", snapshot: { status: "ready" } }),
  );
  const [code] = await closing;
  await disconnected;
  assert.equal(code, 1008);
  assert.equal(session.snapshot, null);
});
