const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  startBrowserTrace,
  TRACE_CATEGORIES,
} = require("../performance/browser-trace.cjs");

function sessionFor(chunks, completion = {}) {
  const session = new EventEmitter();
  session.calls = [];
  session.send = async (method, params) => {
    session.calls.push({ method, params });
    if (method === "Tracing.getCategories")
      return { categories: TRACE_CATEGORIES };
    if (method === "Tracing.end")
      queueMicrotask(() =>
        session.emit("Tracing.tracingComplete", {
          stream: "fixture-trace",
          dataLossOccurred: false,
          ...completion,
        }),
      );
    if (method === "IO.read") {
      const chunk = chunks.shift();
      if (chunk instanceof Error) throw chunk;
      return chunk;
    }
    return {};
  };
  return session;
}

test("trace uses an explicit bounded category list, writes mixed chunks and closes the stream once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rift-trace-test-"));
  try {
    const destination = path.join(dir, "trace.json");
    const session = sessionFor([
      { data: '{"traceEvents":', eof: false },
      {
        data: Buffer.from("[]}").toString("base64"),
        base64Encoded: true,
        eof: true,
      },
    ]);
    const capture = await startBrowserTrace(session, destination);
    const result = await capture.stop();
    assert.deepEqual(JSON.parse(fs.readFileSync(destination)), {
      traceEvents: [],
    });
    assert.equal(result.bytes, Buffer.byteLength('{"traceEvents":[]}'));
    assert.equal(result.dataLossOccurred, false);
    const start = session.calls.find(
      (call) => call.method === "Tracing.start",
    ).params;
    assert.equal(start.transferMode, "ReturnAsStream");
    assert.equal(start.traceConfig.recordMode, "recordUntilFull");
    assert.equal(start.traceConfig.traceBufferSizeInKb, 65536);
    assert.deepEqual(start.traceConfig.includedCategories, TRACE_CATEGORIES);
    assert.ok(
      !start.traceConfig.includedCategories.some((category) =>
        /screenshot|memory-infra/.test(category),
      ),
    );
    assert.deepEqual(await capture.stop(), result);
    assert.equal(
      session.calls.filter((call) => call.method === "Tracing.end").length,
      1,
    );
    assert.equal(
      session.calls.filter((call) => call.method === "IO.close").length,
      1,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const failure of ["limit", "read"]) {
  test(`trace ${failure} failure closes the stream and never presents a partial capture as complete`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rift-trace-test-"));
    try {
      const destination = path.join(dir, "trace.json");
      const session = sessionFor(
        failure === "limit"
          ? [{ data: "oversized", eof: true }]
          : [new Error("read failed")],
      );
      const capture = await startBrowserTrace(session, destination, {
        maxBytes: 4,
      });
      await assert.rejects(
        capture.stop(),
        failure === "limit" ? /byte limit/ : /read failed/,
      );
      assert.equal(fs.existsSync(destination), false);
      assert.equal(
        session.calls.filter((call) => call.method === "IO.close").length,
        1,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("missing required categories fails before tracing starts", async () => {
  const session = new EventEmitter();
  session.send = async (method) => {
    assert.equal(method, "Tracing.getCategories");
    return { categories: ["devtools.timeline"] };
  };
  await assert.rejects(
    startBrowserTrace(session, "/unused"),
    /categories unavailable/,
  );
});

test("browser-reported data loss is retained for the caller to reject attribution", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rift-trace-test-"));
  try {
    const session = sessionFor([{ data: '{"traceEvents":[]}', eof: true }], {
      dataLossOccurred: true,
    });
    const capture = await startBrowserTrace(
      session,
      path.join(dir, "trace.json"),
    );
    assert.equal((await capture.stop()).dataLossOccurred, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("completion timeout removes its listener and rejects repeated stop calls consistently", async () => {
  const session = sessionFor([]);
  const send = session.send;
  session.send = (method, params) =>
    method === "Tracing.end" ? Promise.resolve({}) : send(method, params);
  const capture = await startBrowserTrace(session, "/unused", {
    timeoutMs: 10,
  });
  await assert.rejects(capture.stop(), /completion timed out/);
  await assert.rejects(capture.stop(), /completion timed out/);
  assert.equal(session.listenerCount("Tracing.tracingComplete"), 0);
});

test("stream timeout closes the browser handle and removes only its own partial file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rift-trace-test-"));
  try {
    const destination = path.join(dir, "trace.json");
    const session = sessionFor([]);
    const send = session.send;
    session.send = (method, params) =>
      method === "IO.read" ? new Promise(() => {}) : send(method, params);
    const capture = await startBrowserTrace(session, destination, {
      timeoutMs: 10,
    });
    await assert.rejects(capture.stop(), /stream timed out/);
    assert.equal(fs.existsSync(destination + ".partial"), false);
    assert.equal(
      session.calls.filter((call) => call.method === "IO.close").length,
      1,
    );
    fs.writeFileSync(destination + ".partial", "existing evidence");
    const anotherSession = sessionFor([]);
    const another = await startBrowserTrace(anotherSession, destination);
    await assert.rejects(another.stop(), /EEXIST/);
    assert.equal(
      fs.readFileSync(destination + ".partial", "utf8"),
      "existing evidence",
    );
    assert.equal(
      anotherSession.calls.filter((call) => call.method === "IO.close").length,
      1,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
