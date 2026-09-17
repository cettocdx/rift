import { createExecutionLedger } from "@/packages/console/src/harness-execution";

it("coalesces identical concurrent calls and preserves their confirmed result", async () => {
  const ledger = createExecutionLedger();
  const action = jest.fn(async () => "written");
  const identity = {
    id: "call-1",
    name: "edit_file",
    input: { path: "x", text: "new" },
  };
  expect(
    await Promise.all([
      ledger.run(identity, action),
      ledger.run(identity, action),
    ]),
  ).toEqual(["written", "written"]);
  expect(await ledger.run(identity, action)).toBe("written");
  expect(action).toHaveBeenCalledTimes(1);
});
it("refuses reused identities with different input and never repeats failed effects", async () => {
  const ledger = createExecutionLedger();
  const action = jest.fn(async () => {
    throw new Error("unknown outcome");
  });
  const call = { id: "x", name: "command", input: { command: "do work" } };
  await expect(ledger.run(call, action)).rejects.toThrow("unknown outcome");
  await expect(ledger.run(call, action)).rejects.toThrow("unknown outcome");
  await expect(
    ledger.run({ ...call, input: { command: "other" } }, action),
  ).rejects.toThrow(/identity/);
  expect(action).toHaveBeenCalledTimes(1);
});
it("isolates runs and recognizes equivalent object key order", async () => {
  const first = createExecutionLedger(),
    second = createExecutionLedger();
  const action = jest.fn(async () => 1);
  await first.run({ id: "x", name: "edit", input: { a: 1, b: 2 } }, action);
  await first.run({ id: "x", name: "edit", input: { b: 2, a: 1 } }, action);
  await second.run({ id: "x", name: "edit", input: { a: 1, b: 2 } }, action);
  expect(action).toHaveBeenCalledTimes(2);
});
