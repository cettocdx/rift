#!/usr/bin/env -S node --experimental-strip-types
const {
  waitForCommandReceiver,
} = require("../lib/centrifugo/command-readiness.ts");
// Isolated QA runner/proxy: never interrupts the user's managed runner or network.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  counterCommand,
  executionCount,
  assertOrderedMarkers,
  assertDisconnected,
  stopLauncher,
} = require("./local-runner-fault-checks.cjs");
const { spawn, execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const localRequire = createRequire(
  path.resolve(__dirname, "../packages/local/package.json"),
);
const WS = localRequire("ws");
const { Centrifuge } = localRequire("centrifuge");
const { ConvexHttpClient } = localRequire("convex/browser");
const config = JSON.parse(
  fs.readFileSync(
    path.join(os.homedir(), ".config/rift/local-runner.json"),
    "utf8",
  ),
);
const convex = new ConvexHttpClient(config.convexUrl);
const killSignal = process.env.RIFT_QA_KILL_SIGNAL || "SIGTERM";
if (!["SIGTERM", "SIGKILL"].includes(killSignal))
  throw new Error("Use SIGTERM or SIGKILL for the isolated launcher");
const dir = fs.mkdtempSync("/tmp/rift-local-fault-");
const outageMs = Number(process.env.RIFT_QA_OUTAGE_MS || 15000);
if (!Number.isFinite(outageMs) || outageMs < 1000 || outageMs > 90000)
  throw new Error("Use a 1–90 second isolated outage");
const result = {
  directory: dir,
  scenarios: [],
  runnerConnections: 0,
  stage: "initializing",
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let child,
  observer,
  server,
  registration,
  activeSub,
  activeCommandId,
  activeExit,
  activeCommandIssued = false,
  offline = false;
const pairs = new Set();
async function until(fn, ms = 20000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw Error("QA_TIMEOUT");
    await wait(100);
  }
}
(async () => {
  // Compile into the test directory; do not replace a running receiver's dist.
  const runtime = path.join(dir, "runtime");
  execFileSync(
    process.execPath,
    [
      localRequire.resolve("typescript/bin/tsc"),
      "--project",
      path.resolve(__dirname, "../packages/local/tsconfig.json"),
      "--outDir",
      runtime,
    ],
    { stdio: "pipe" },
  );
  fs.symlinkSync(
    path.resolve(__dirname, "../packages/local/node_modules"),
    path.join(dir, "node_modules"),
    "junction",
  );
  registration = await convex.mutation("localSandbox:connect", {
    token: config.token,
    connectionName: "RIFT isolated continuity QA",
    clientVersion: "1.0.0",
    capabilities: { commands: true, pty: false, commandReadiness: true },
  });
  if (
    !registration.success ||
    !registration.userId ||
    !registration.connectionId ||
    !registration.centrifugoToken ||
    !registration.centrifugoWsUrl
  )
    throw new Error(
      "Configured runner token could not authorize isolated QA registration",
    );
  fs.mkdirSync(path.join(dir, "state"), { mode: 0o700 });
  fs.writeFileSync(
    path.join(dir, "state/relay.json"),
    JSON.stringify({
      userId: registration.userId,
      connectionId: registration.connectionId,
      wsUrl: registration.centrifugoWsUrl,
    }),
    { mode: 0o600 },
  );
  result.authorizedIdentitySource = "localSandbox.connect";
  result.currentSourceCompiled = true;
  server = new WS.WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  server.on("connection", (down) => {
    if (offline) {
      down.close();
      return;
    }
    const up = new WS(registration.centrifugoWsUrl);
    const pair = { up, down };
    pairs.add(pair);
    const pending = [];
    down.on("message", (data) => {
      if (up.readyState === WS.OPEN) up.send(data.toString());
      else pending.push(data.toString());
    });
    up.on("open", () => pending.splice(0).forEach((d) => up.send(d)));
    up.on(
      "message",
      (d) => down.readyState === WS.OPEN && down.send(d.toString()),
    );
    const close = () => {
      pairs.delete(pair);
      up.terminate();
      down.terminate();
    };
    up.on("close", close);
    down.on("close", close);
    up.on("error", () => {});
    down.on("error", () => {});
  });
  const shim = path.join(dir, "proxy.cjs");
  fs.writeFileSync(
    shim,
    `const p=${JSON.stringify(localRequire.resolve("ws"))}; const Original=require(p); require.cache[p].exports=class extends Original {constructor(url,opts){super(process.env.RIFT_QA_PROXY,opts);}};`,
  );
  async function start() {
    let connectionId;
    child = spawn(
      process.execPath,
      [
        "--require",
        shim,
        path.join(runtime, "index.js"),
        "--convex-url",
        config.convexUrl,
        "--name",
        "RIFT isolated continuity QA",
        "--keep-alive",
      ],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          HOME: dir,
          TMPDIR: dir,
          RIFT_LOCAL_TOKEN: config.token,
          RIFT_RUNNER_STATE_DIR: path.join(dir, "state"),
          RIFT_QA_PROXY: `ws://127.0.0.1:${server.address().port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let transcript = "";
    child.stdout.on("data", (b) => {
      transcript += b.toString();
      result.runnerConnections += (
        b.toString().match(/Connected to command relay/g) || []
      ).length;
      connectionId = transcript.match(/Connection: ([a-f0-9-]+)/)?.[1];
    });
    child.stderr.on("data", () => {});
    await until(
      () => connectionId && transcript.includes("Connected to command relay"),
    );
    return connectionId;
  }
  async function observe(id) {
    if (id !== registration.connectionId)
      throw new Error("QA runner changed its authorized connection");
    const user = registration.userId;
    observer = new Centrifuge(registration.centrifugoWsUrl, {
      token: registration.centrifugoToken,
      websocket: WS,
    });
    const sub = observer.newSubscription(`sandbox:connection:${id}#${user}`);
    let ready = false;
    sub.on("subscribed", () => (ready = true));
    sub.subscribe();
    observer.connect();
    await until(() => ready);
    return sub;
  }
  let id = await start(),
    sub = await observe(id),
    commandId = crypto.randomUUID();
  let output = "",
    exit;
  activeSub = sub;
  activeCommandId = commandId;
  sub.on("publication", ({ data: d }) => {
    if (d.commandId !== commandId) return;
    if (d.type === "stdout") output += d.data;
    if (d.type === "exit") {
      exit = d.exitCode;
      activeExit = d.exitCode;
      activeCommandIssued = false;
    }
  });
  await waitForCommandReceiver(sub, id);
  activeCommandIssued = true;
  await sub.publish({
    type: "command",
    commandId,
    targetConnectionId: id,
    command: `${counterCommand(path.join(dir, "network-starts"))}; i=0; while [ "$i" -lt 60 ]; do printf 'RIFT_QA_%s\n' "$i"; i=$((i+1)); sleep 1; done`,
    timeout: 90000,
  });
  await until(() => output.includes("RIFT_QA_3"));
  offline = true;
  for (const { up, down } of pairs) {
    up.terminate();
    down.terminate();
  }
  await wait(outageMs);
  offline = false;
  await until(() => exit !== undefined, 100000);
  const markers = Array.from(output.matchAll(/RIFT_QA_(\d+)/g), (m) =>
    Number(m[1]),
  );
  result.scenarios.push({
    name: `runner-network-outage-${outageMs / 1000}s`,
    exit,
    received: markers.length,
    missing: Array.from({ length: 60 }, (_, i) => i).filter(
      (i) => !markers.includes(i),
    ),
    duplicates: markers.length - new Set(markers).size,
    executionCount: executionCount(path.join(dir, "network-starts")),
    ordered: markers.every((value, index) => value === index),
  });
  console.log(JSON.stringify(result.scenarios.at(-1)));
  assertOrderedMarkers(markers, 60);
  if (
    exit !== 0 ||
    markers.length !== 60 ||
    new Set(markers).size !== 60 ||
    result.scenarios[0].executionCount !== 1
  )
    throw new Error("NETWORK_CONTINUITY_FAILED");
  result.stage = "restart-command-admission";
  commandId = crypto.randomUUID();
  activeCommandId = commandId;
  activeExit = undefined;
  output = "";
  exit = undefined;
  await waitForCommandReceiver(sub, id);
  activeCommandIssued = true;
  await sub.publish({
    type: "command",
    commandId,
    targetConnectionId: id,
    command: `${counterCommand(path.join(dir, "restart-starts"))}; printf RIFT_RESTART_STARTED; sleep 8; printf RIFT_RESTART_FINISHED`,
    timeout: 90000,
  });
  await until(() => output.includes("RIFT_RESTART_STARTED"));
  result.stage = "launcher-restart";
  const previousChild = child;
  await stopLauncher(previousChild, killSignal);
  const restartedId = await start();
  result.stage = "original-command-completion";
  let continued = false;
  try {
    await until(() => exit !== undefined, 20000);
    continued = output.includes("RIFT_RESTART_FINISHED") && exit === 0;
  } catch {}
  result.scenarios.push({
    name: "runner-process-restart",
    reRegistered: Boolean(restartedId),
    sameConnectionId: restartedId === id,
    originalCommandResumed: continued,
    originalExit: exit,
    executionCount: executionCount(path.join(dir, "restart-starts")),
  });
  if (
    !continued ||
    restartedId !== id ||
    result.scenarios.at(-1).executionCount !== 1
  )
    throw new Error("RESTART_CONTINUITY_FAILED");
  console.log(JSON.stringify(result.scenarios.at(-1)));
  commandId = crypto.randomUUID();
  activeCommandId = commandId;
  activeExit = undefined;
  output = "";
  exit = undefined;
  await waitForCommandReceiver(sub, id);
  activeCommandIssued = true;
  await sub.publish({
    type: "command",
    commandId,
    targetConnectionId: id,
    command: "printf RIFT_AFTER_RESTART",
    timeout: 10000,
  });
  await until(() => exit !== undefined);
  if (exit !== 0 || output !== "RIFT_AFTER_RESTART")
    throw new Error("POST_RESTART_COMMAND_FAILED");
  result.scenarios.push({ name: "next-command-after-restart", exit, output });
  commandId = crypto.randomUUID();
  activeCommandId = commandId;
  activeExit = undefined;
  output = "";
  exit = undefined;
  await waitForCommandReceiver(sub, id);
  activeCommandIssued = true;
  await sub.publish({
    type: "command",
    commandId,
    targetConnectionId: id,
    command: "printf RIFT_CANCEL_READY; sleep 30; printf RIFT_SHOULD_NOT_RUN",
    timeout: 35000,
  });
  await until(() => output.includes("RIFT_CANCEL_READY"));
  await sub.publish({
    type: "command_cancel",
    commandId,
    targetConnectionId: id,
  });
  await until(() => exit !== undefined);
  if (exit !== 130 || output.includes("RIFT_SHOULD_NOT_RUN"))
    throw new Error("CANCELLATION_FAILED");
  result.scenarios.push({ name: "cancel-after-restart", exit, output });
  result.stage = "complete";
})()
  .catch((e) => {
    result.error = e.message;
    process.exitCode = 1;
  })
  .finally(async () => {
    offline = false;
    try {
      if (
        activeSub &&
        activeCommandId &&
        activeCommandIssued &&
        activeExit === undefined
      ) {
        await activeSub.publish({
          type: "command_cancel",
          commandId: activeCommandId,
          targetConnectionId: registration.connectionId,
        });
        await until(() => activeExit !== undefined, 100000);
      }
    } catch {
      result.cleanupCommandUnconfirmed = true;
      process.exitCode = 1;
    }
    observer?.disconnect();
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        await stopLauncher(child);
      } catch {
        result.launcherCleanupFailed = true;
        process.exitCode = 1;
      }
    }
    for (const { up, down } of pairs) {
      up.terminate();
      down.terminate();
    }
    if (server) await new Promise((r) => server.close(r));
    if (registration?.success) {
      try {
        const disconnected = await convex.mutation("localSandbox:disconnect", {
          token: config.token,
          connectionId: registration.connectionId,
        });
        assertDisconnected(disconnected);
        result.registrationDisconnected = true;
      } catch {
        result.registrationDisconnected = false;
        process.exitCode = 1;
      }
    }
    result.launcherStopped =
      !child || child.exitCode !== null || child.signalCode !== null;
    result.proxyClosed = true;
    fs.writeFileSync(
      "/tmp/rift-local-fault-results.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  });
