/** @jest-environment node */
import { recoverAgentDispatch } from "../agent-dispatch-recovery";
const saved = process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION;
const init = {
  method: "POST",
  body: JSON.stringify({
    chatId: "chat",
    messages: [{ role: "user", id: "message", parts: [] }],
  }),
};
const receipt = (patch = {}) =>
  Response.json({
    delivery: "accepted",
    dispatchId: "message",
    runId: "original",
    publicAccessToken: "read-token",
    ...patch,
  });
beforeEach(() => {
  process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION = "true";
  global.fetch = jest.fn().mockResolvedValue(receipt());
});
afterEach(() => {
  if (saved === undefined)
    delete process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION;
  else process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION = saved;
});
it("performs one read-only exact-request lookup", async () => {
  expect(await (await recoverAgentDispatch(init))?.json()).toMatchObject({
    runId: "original",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    "/api/agent-long/receipt?chatId=chat&dispatchId=message",
    expect.objectContaining({ method: "GET", cache: "no-store" }),
  );
});
it.each([
  { delivery: "unconfirmed" },
  { dispatchId: "different" },
  { publicAccessToken: "" },
  { runId: "" },
])("refuses nonauthoritative acceptance %j", async (patch) => {
  (fetch as jest.Mock).mockResolvedValue(receipt(patch));
  expect(await recoverAgentDispatch(init)).toBeNull();
});
it.each([{ temporary: true }, { regenerate: true }, { isAutoContinue: true }])(
  "excludes identities not yet durable %j",
  async (flags) => {
    expect(
      await recoverAgentDispatch({
        ...init,
        body: JSON.stringify({ ...JSON.parse(init.body), ...flags }),
      }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("does not look up after Stop", async () => {
  const c = new AbortController();
  c.abort();
  expect(await recoverAgentDispatch({ ...init, signal: c.signal })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it("Stop ends a pending lookup even when the fetch ignores abort", async () => {
  const c = new AbortController();
  (fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const pending = recoverAgentDispatch({ ...init, signal: c.signal });
  c.abort();
  expect(await pending).toBeNull();
});
it("bounds receipt reads even when the network ignores abort", async () => {
  (fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
  expect(await recoverAgentDispatch(init, 5)).toBeNull();
});
it("does not mistake a failed read for dispatch permission", async () => {
  (fetch as jest.Mock).mockRejectedValue(new Error("offline"));
  expect(await recoverAgentDispatch(init)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("disabled rollout performs no lookup", async () => {
  delete process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION;
  expect(await recoverAgentDispatch(init)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("recovers an exact canceled Hack receipt without requiring a worker to exist", async () => {
  (fetch as jest.Mock).mockResolvedValue(
    Response.json({
      delivery: "canceled",
      dispatchId: "message",
      canceled: true,
    }),
  );
  expect(
    await (await recoverAgentDispatch(init, 3000, "hack"))?.json(),
  ).toEqual({ delivery: "canceled", dispatchId: "message", canceled: true });
});
it.each([
  { delivery: "canceled", dispatchId: "different", canceled: true },
  { delivery: "canceled", dispatchId: "message", canceled: false },
])("does not recover an unconfirmed canceled receipt %j", async (value) => {
  (fetch as jest.Mock).mockResolvedValue(Response.json(value));
  expect(await recoverAgentDispatch(init, 3000, "hack")).toBeNull();
});
