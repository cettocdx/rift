/** @jest-environment node */
import {
  reconcileRemoteExitReceipts,
  type PendingResource,
} from "../reconcile-remote-exit-receipts";
const owner = {
  userId: "owner",
  chatId: "chat",
  claimId: "claim",
  runId: "run",
};
const resource: PendingResource = {
  ...owner,
  resourceId: "resource",
  sandboxId: "sandbox",
  pid: 123,
  processIdentity: "supervised-v1:boot:42:resource",
};
const receipt = {
  resourceId: "resource",
  pid: 123,
  processIdentity: resource.processIdentity!,
  state: "exited",
  descendantsReaped: true,
};
function fixture() {
  return {
    producer: jest.fn(async () => ({
      ...owner,
      id: owner.runId,
      taskIdentifier: "agent-long",
      status: "CRASHED",
    })),
    page: jest.fn(async (state: string, _cursor: string | null) => ({
      page: state === "started" ? [resource] : [],
      isDone: true,
      continueCursor: "",
    })),
    read: jest.fn(async () => receipt as unknown),
    started: jest.fn(async () => true),
    exited: jest.fn(async () => true),
  };
}
it("recovers an exact final receipt after producer death", async () => {
  const deps = fixture();
  const result = await reconcileRemoteExitReceipts(owner, deps);
  expect(result.reconciled).toBe(1);
  expect(deps.exited).toHaveBeenCalledWith(resource, receipt);
});
it.each(["EXECUTING", "QUEUED", "UNRECOGNIZED_STATUS"])(
  "does not touch resources for a nonterminal producer (%s)",
  async (status) => {
    const deps = fixture();
    deps.producer.mockResolvedValue({
      ...owner,
      id: owner.runId,
      taskIdentifier: "agent-long",
      status,
    });
    expect(
      (await reconcileRemoteExitReceipts(owner, deps)).producerActive,
    ).toBe(true);
    expect(deps.page).not.toHaveBeenCalled();
  },
);
it.each([
  { userId: "foreign" },
  { chatId: "foreign" },
  { claimId: "newer" },
  { id: "other-run" },
  { taskIdentifier: "unrelated-task" },
])("rejects producer ownership mismatch %j", async (patch) => {
  const deps = fixture();
  deps.producer.mockResolvedValue({
    ...owner,
    id: owner.runId,
    taskIdentifier: "agent-long",
    status: "CRASHED",
    ...patch,
  });
  await expect(reconcileRemoteExitReceipts(owner, deps)).rejects.toThrow(
    "ownership",
  );
  expect(deps.read).not.toHaveBeenCalled();
});
it.each([
  { pid: 124 },
  { resourceId: "other" },
  { processIdentity: "supervised-v1:reused:resource" },
  { state: "started" },
  { descendantsReaped: false },
])("keeps mismatching/incomplete evidence unresolved %j", async (patch) => {
  const deps = fixture();
  deps.read.mockResolvedValue({ ...receipt, ...patch });
  expect((await reconcileRemoteExitReceipts(owner, deps)).unconfirmed).toBe(1);
  expect(deps.exited).not.toHaveBeenCalled();
});
it("does not infer exit from a missing sandbox/receipt", async () => {
  const deps = fixture();
  deps.read.mockRejectedValue(new Error("not found"));
  expect((await reconcileRemoteExitReceipts(owner, deps)).unconfirmed).toBe(1);
  expect(deps.started).not.toHaveBeenCalled();
});
it("never writes exit after unsuccessful start persistence", async () => {
  const deps = fixture();
  deps.started.mockResolvedValue(false);
  expect((await reconcileRemoteExitReceipts(owner, deps)).unconfirmed).toBe(1);
  expect(deps.exited).not.toHaveBeenCalled();
});
it("can recover a lost start acknowledgment from an exact final remote receipt", async () => {
  const deps = fixture();
  deps.page.mockImplementation(async (state) => ({
    page:
      state === "reserved"
        ? [{ ...resource, pid: undefined, processIdentity: undefined }]
        : [],
    isDone: true,
    continueCursor: "",
  }));
  expect((await reconcileRemoteExitReceipts(owner, deps)).reconciled).toBe(1);
});
it("rejects a foreign resource returned in an otherwise owned page", async () => {
  const deps = fixture();
  deps.page.mockResolvedValue({
    page: [{ ...resource, userId: "foreign" }],
    isDone: true,
    continueCursor: "",
  });
  await expect(reconcileRemoteExitReceipts(owner, deps)).rejects.toThrow(
    "ownership",
  );
  expect(deps.read).not.toHaveBeenCalled();
});
it("follows subsequent inventory pages", async () => {
  const deps = fixture();
  deps.page.mockImplementation(async (state, cursor) => ({
    page: state === "started" && cursor ? [resource] : [],
    isDone: state === "reserved" || !!cursor,
    continueCursor: "next",
  }));
  expect((await reconcileRemoteExitReceipts(owner, deps)).reconciled).toBe(1);
  expect(deps.page).toHaveBeenCalledWith("started", "next");
});
it("honors cancellation without interpreting it as cleanup", async () => {
  const deps = fixture(),
    controller = new AbortController();
  controller.abort();
  expect(
    (await reconcileRemoteExitReceipts(owner, deps, controller.signal))
      .interrupted,
  ).toBe(true);
  expect(deps.page).not.toHaveBeenCalled();
});

it("finishes the exact claim only with independent worker drain proof and all exits saved", async () => {
  const base = fixture();
  const complete = jest.fn(async () => true);
  const deps = {
    ...base,
    complete,
    producer: async () => ({
      ...(await base.producer()),
      cleanupDrained: true,
    }),
  };
  const result = await reconcileRemoteExitReceipts(owner, deps);
  expect(complete).toHaveBeenCalledWith(owner);
  expect(result).toMatchObject({ released: true, unconfirmed: 0 });
});

it.each(["missing-proof", "pending-exit", "hack"])(
  "retains the claim for %s",
  async (scenario) => {
    const base = fixture();
    const complete = jest.fn(async () => true);
    if (scenario === "pending-exit")
      base.read.mockResolvedValue({ ...receipt, state: "started" });
    const deps = {
      ...base,
      complete,
      producer: async () => ({
        ...(await base.producer()),
        taskIdentifier: scenario === "hack" ? "hack-long" : "agent-long",
        cleanupDrained: scenario !== "missing-proof",
      }),
    };
    await reconcileRemoteExitReceipts(owner, deps);
    expect(complete).not.toHaveBeenCalled();
  },
);

it("settles a verified absent sandbox without inventing process exit", async () => {
  const deps = {
    ...fixture(),
    absent: jest.fn(async () => true),
    complete: jest.fn(async () => true),
  };
  deps.producer.mockResolvedValue({
    ...owner,
    id: owner.runId,
    taskIdentifier: "agent-long",
    status: "COMPLETED",
    cleanupDrained: true,
  } as any);
  deps.read.mockRejectedValue(new Error("gone"));
  expect(await reconcileRemoteExitReceipts(owner, deps)).toMatchObject({
    reconciled: 1,
    unconfirmed: 0,
    released: true,
  });
  expect(deps.absent).toHaveBeenCalledWith(resource);
  expect(deps.exited).not.toHaveBeenCalled();
});
it("cannot settle absence without worker drain proof", async () => {
  const deps = {
    ...fixture(),
    absent: jest.fn(async () => true),
    complete: jest.fn(async () => true),
  };
  deps.read.mockRejectedValue(new Error("gone"));
  expect(await reconcileRemoteExitReceipts(owner, deps)).toMatchObject({
    unconfirmed: 1,
    released: false,
  });
  expect(deps.absent).not.toHaveBeenCalled();
});
