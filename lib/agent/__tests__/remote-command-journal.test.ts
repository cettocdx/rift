/** @jest-environment node */
import {
  bindRemoteCommandJournal,
  buildJournalLaunch,
  prepareJournaledCommand,
  withRemoteCommandJournal,
  type JournalStore,
} from "../remote-command-journal";
const owner = {
  userId: "owner",
  chatId: "chat",
  claimId: "claim",
  runId: "run",
};
function fixture() {
  let binding: any;
  const store: JournalStore = {
    reserve: jest.fn(async (args) => {
      binding = args;
      return true;
    }),
    started: jest.fn(async () => true),
    exited: jest.fn(async () => true),
    notStarted: jest.fn(async () => true),
  };
  const sandbox = {
    sandboxId: "sandbox",
    commands: { run: jest.fn(async () => ({})) },
    files: {
      read: jest.fn(async () =>
        JSON.stringify({
          resourceId: binding.resourceId,
          pid: 123,
          processIdentity: `supervised-v1:boot:42:${binding.resourceId}`,
          state: "exited",
          descendantsReaped: true,
        }),
      ),
    },
  };
  const prepare = () =>
    withRemoteCommandJournal(async () => {
      bindRemoteCommandJournal(owner);
      return prepareJournaledCommand("printf hello", sandbox, store);
    });
  return { store, sandbox, prepare };
}
it("does not journal executions outside an admitted worker scope", async () => {
  const f = fixture();
  expect(
    await prepareJournaledCommand("echo hello", f.sandbox, f.store),
  ).toBeUndefined();
  expect(f.store.reserve).not.toHaveBeenCalled();
});
it("requires durable admission before returning a launch command", async () => {
  const f = fixture();
  (f.store.reserve as jest.Mock).mockResolvedValue(false);
  await expect(f.prepare()).rejects.toThrow("not authorized");
  expect(f.sandbox.files.read).not.toHaveBeenCalled();
});
it("recovers a transient exit-receipt timeout without resubmitting the command", async () => {
  const f = fixture();
  const prepared = (await f.prepare())!;
  await prepared.started(123);
  f.sandbox.files.read.mockRejectedValueOnce(
    new DOMException("read timed out", "TimeoutError"),
  );
  await prepared.exited(123);
  expect(f.store.exited).toHaveBeenCalledTimes(1);
  expect(f.store.started).toHaveBeenCalledTimes(1);
  expect(f.sandbox.commands.run).not.toHaveBeenCalled();
});
it("leaves cleanup unconfirmed when all exit-receipt reads fail", async () => {
  const f = fixture();
  const prepared = (await f.prepare())!;
  await prepared.started(123);
  f.sandbox.files.read
    .mockClear()
    .mockRejectedValue(new DOMException("read timed out", "TimeoutError"));
  await expect(prepared.exited(123)).rejects.toThrow("read timed out");
  expect(f.sandbox.files.read).toHaveBeenCalledTimes(4);
  expect(f.store.exited).not.toHaveBeenCalled();
  expect(f.sandbox.commands.run).not.toHaveBeenCalled();
});
it("rejects a mismatched exit receipt after a recovered read timeout", async () => {
  const f = fixture();
  const prepared = (await f.prepare())!;
  const identity = await prepared.started(123);
  f.sandbox.files.read
    .mockRejectedValueOnce(new DOMException("read timed out", "TimeoutError"))
    .mockResolvedValue(
      JSON.stringify({
        ...identity,
        processIdentity: "another-process",
        state: "exited",
        descendantsReaped: true,
      }),
    );
  await expect(prepared.exited(123)).rejects.toThrow("descendants");
  expect(f.store.exited).not.toHaveBeenCalled();
  expect(f.sandbox.commands.run).not.toHaveBeenCalled();
});
it("saves start once and only saves exit after the remote receipt is saved", async () => {
  const f = fixture();
  const prepared = (await f.prepare())!;
  await Promise.all([prepared.started(123), prepared.started(123)]);
  expect(f.store.started).toHaveBeenCalledTimes(1);
  expect(f.store.exited).not.toHaveBeenCalled();
  await prepared.exited(123);
  expect(f.store.exited).toHaveBeenCalledTimes(1);
  await expect(prepared.started(124)).rejects.toThrow("PID changed");
});
it("rejects a receipt from a different remote process", async () => {
  const f = fixture();
  const prepared = (await f.prepare())!;
  await expect(prepared.started(124)).rejects.toThrow("identity mismatch");
  expect(f.store.started).not.toHaveBeenCalled();
  expect(f.store.exited).not.toHaveBeenCalled();
});
it("never claims exit when saving the start fails", async () => {
  const f = fixture();
  (f.store.started as jest.Mock).mockRejectedValue(new Error("offline"));
  const prepared = (await f.prepare())!;
  await expect(prepared.exited(123)).rejects.toThrow("offline");
  expect(f.store.exited).not.toHaveBeenCalled();
});
it("records explicit unsent proof and refuses to later start that reservation", async () => {
  const f = fixture();
  const prepared = (await f.prepare())!;
  await prepared.notStarted();
  await expect(prepared.started(123)).rejects.toThrow("not submitted");
  expect(f.store.notStarted).toHaveBeenCalledTimes(1);
});
it("cannot abandon a command after its start receipt begins", async () => {
  const f = fixture();
  const prepared = (await f.prepare())!;
  await prepared.started(123);
  await expect(prepared.notStarted()).rejects.toThrow("start receipt");
  expect(f.store.notStarted).not.toHaveBeenCalled();
});
it("keeps shell metacharacters solely in the encoded command payload", () => {
  const command = "printf '%s' '`secret` $(secret)'; echo 'quote'\nexit 9";
  const result = buildJournalLaunch(command, {
    ...owner,
    resourceId: "nonce",
    sandboxId: "sandbox",
  });
  expect(result.command).not.toContain("$(secret)");
  const payload = result.command.split(" ").at(-1)!.slice(1, -1);
  expect(JSON.parse(Buffer.from(payload, "base64").toString()).command).toBe(
    command,
  );
});
it("isolates simultaneous worker scopes", async () => {
  const f = fixture();
  await Promise.all(
    [owner, { ...owner, runId: "second" }].map((binding) =>
      withRemoteCommandJournal(async () => {
        bindRemoteCommandJournal(binding);
        await Promise.resolve();
        await prepareJournaledCommand("true", f.sandbox, f.store);
      }),
    ),
  );
  expect(
    (f.store.reserve as jest.Mock).mock.calls
      .map(([args]) => args.runId)
      .sort(),
  ).toEqual(["run", "second"]);
});

it("does not save exit without the supervisor's descendant cleanup proof", async () => {
  const f = fixture();
  const prepared = (await f.prepare())!;
  const identity = await prepared.started(123);
  f.sandbox.files.read.mockResolvedValue(
    JSON.stringify({
      resourceId: identity.resourceId,
      pid: 123,
      processIdentity: identity.processIdentity,
      state: "started",
      descendantsReaped: false,
    }),
  );
  await expect(prepared.exited(123)).rejects.toThrow("descendants");
  expect(f.store.exited).not.toHaveBeenCalled();
});
it("can stop the verified remote supervisor even when backend start persistence fails", async () => {
  const f = fixture();
  (f.store.started as jest.Mock).mockRejectedValue(new Error("offline"));
  const prepared = (await f.prepare())!;
  await prepared.stop(123);
  expect(f.sandbox.commands.run).toHaveBeenCalledTimes(1);
  expect(f.store.exited).not.toHaveBeenCalled();
});

it("passes a bounded budget to the remote supervisor", () => {
  const binding = { ...owner, resourceId: "nonce", sandboxId: "sandbox" };
  for (const budget of [125, 60 * 60 * 1000]) {
    const launch = buildJournalLaunch("sleep 10", binding, budget);
    const payload = launch.command.split(" ").at(-1)!.slice(1, -1);
    expect(JSON.parse(Buffer.from(payload, "base64").toString()).budgetMs).toBe(
      Math.min(budget, 30 * 60 * 1000),
    );
  }
  expect(() => buildJournalLaunch("true", binding, NaN)).toThrow("budget");
});
