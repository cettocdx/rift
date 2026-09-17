const test = require("node:test");
const assert = require("node:assert/strict");
const { startLaunch } = require("./boot-runtime");

function setup(fetchImplementation) {
  const timers = new Map();
  let nextTimer = 0;
  const listeners = new Map();
  const calls = [];
  const navigations = [];
  const root = { dataset: { state: "loading" } };
  const elements = Object.fromEntries(
    ["status-text", "error-message", "retry-btn"].map((id) => [
      id,
      {
        hidden: id !== "status-text",
        disabled: false,
        textContent: "",
        addEventListener(name, fn) {
          listeners.set(`${id}:${name}`, fn);
        },
        removeEventListener(name) {
          listeners.delete(`${id}:${name}`);
        },
      },
    ]),
  );
  const scope = {
    document: {
      querySelector: () => root,
      getElementById: (id) => elements[id],
    },
    AbortController,
    navigator: { onLine: true },
    fetch: (...args) => {
      calls.push(args);
      return fetchImplementation(...args);
    },
    location: { replace: (url) => navigations.push(url) },
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  const dispose = startLaunch(scope, "http://localhost:3020/");
  return {
    root,
    elements,
    calls,
    navigations,
    timers,
    dispose,
    emit(name) {
      return listeners.get(name)?.();
    },
    runTimer(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].fn();
    },
  };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("probes the real destination and navigates immediately without an artificial wait", async () => {
  const view = setup(async () => ({ type: "opaque", ok: false }));
  await flush();
  assert.equal(view.calls.length, 1);
  assert.equal(view.calls[0][0], "http://localhost:3020/");
  assert.equal(view.calls[0][1].method, "HEAD");
  assert.equal(view.calls[0][1].mode, "no-cors");
  assert.equal(view.calls[0][1].cache, "no-store");
  assert.deepEqual(view.navigations, ["http://localhost:3020/"]);
  assert.equal(view.elements["status-text"].textContent, "Opening RIFT");
  assert.equal(
    [...view.timers.values()].some((timer) => timer.delay === 5000),
    false,
  );
  view.emit("pagehide");
  assert.equal(view.timers.size, 0);
});

test("does not trust navigator.onLine or leave failed-probe timeouts running", async () => {
  const view = setup(async () => {
    throw new Error("Network unavailable");
  });
  await flush();
  assert.deepEqual(view.navigations, []);
  assert.equal(view.root.dataset.state, "error");
  assert.equal(view.elements["retry-btn"].hidden, false);
  assert.match(
    view.elements["error-message"].textContent,
    /Check your connection/,
  );
  assert.equal(view.timers.size, 0);
  view.dispose();
});

test("explains timeout failures and unlocks retry", async () => {
  const view = setup(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  view.runTimer(5000);
  await flush();
  assert.equal(view.root.dataset.state, "error");
  assert.match(view.elements["error-message"].textContent, /timed out/);
  assert.equal(view.elements["retry-btn"].disabled, false);
  assert.equal(view.timers.size, 0);
  view.dispose();
});

test("prevents overlapping clicks and online events, then retries a failed launch once", async () => {
  let fail;
  const view = setup(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  view.emit("retry-btn:click");
  view.emit("online");
  assert.equal(view.calls.length, 1);
  fail(new Error("offline"));
  await flush();
  view.emit("online");
  view.emit("retry-btn:click");
  view.emit("online");
  assert.equal(view.calls.length, 2);
  view.dispose();
});

test("surfaces an HTTP failure when a readable response is available", async () => {
  const view = setup(async () => ({ type: "basic", ok: false, status: 503 }));
  await flush();
  assert.equal(view.root.dataset.state, "error");
  assert.match(
    view.elements["error-message"].textContent,
    /unavailable right now/,
  );
  assert.deepEqual(view.navigations, []);
  view.dispose();
});

test("offers retry if navigation stalls with the launch document still mounted", async () => {
  const view = setup(async () => ({ type: "opaque" }));
  await flush();
  view.emit("retry-btn:click");
  assert.equal(view.calls.length, 1);
  view.runTimer(15000);
  assert.equal(view.root.dataset.state, "error");
  assert.match(
    view.elements["error-message"].textContent,
    /longer than expected/,
  );
  view.emit("retry-btn:click");
  await flush();
  assert.equal(view.calls.length, 2);
  assert.equal(view.navigations.length, 2);
  view.dispose();
});

test("aborts and silences pending work when navigation replaces the launch document", async () => {
  let resolve;
  const view = setup(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  view.emit("pagehide");
  assert.equal(view.calls[0][1].signal.aborted, true);
  assert.equal(view.timers.size, 0);
  resolve({ type: "opaque" });
  await flush();
  assert.deepEqual(view.navigations, []);
  view.emit("online");
  assert.equal(view.calls.length, 1);
});
