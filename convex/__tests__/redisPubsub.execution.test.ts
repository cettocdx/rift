/** @jest-environment node */
const mockClient = {
  on: jest.fn(),
  connect: jest.fn(),
  publish: jest.fn(),
  quit: jest.fn(),
};
jest.mock("../_generated/server", () => ({
  internalAction: (c: unknown) => c,
}));
jest.mock("redis", () => ({ createClient: () => mockClient }));
import { publishCancellation } from "../redisPubsub";
const savedUrl = process.env.REDIS_URL;
beforeEach(() => {
  process.env.REDIS_URL = "redis://fixture";
  jest.clearAllMocks();
});
afterEach(() => {
  if (savedUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = savedUrl;
});
it("retains the old channel and payload for callers without an execution identity", async () => {
  expect(
    await (publishCancellation as any).handler(
      {},
      { chatId: "chat", skipSave: true },
    ),
  ).toBe(true);
  expect(mockClient.publish).toHaveBeenCalledWith(
    "stream:cancel:chat",
    JSON.stringify({ canceled: true, skipSave: true }),
  );
});
it("publishes only the exact execution channel with an independently verifiable payload identity", async () => {
  await (publishCancellation as any).handler(
    {},
    { chatId: "chat", executionId: "exec-a", skipSave: true },
  );
  expect(mockClient.publish).toHaveBeenCalledWith(
    "stream:cancel:execution:chat:exec-a",
    JSON.stringify({ canceled: true, executionId: "exec-a", skipSave: true }),
  );
  expect(mockClient.publish).toHaveBeenCalledTimes(1);
});
it("encodes identity boundaries so different chat/execution tuples cannot collide", async () => {
  await (publishCancellation as any).handler(
    {},
    { chatId: "chat:one", executionId: "exec" },
  );
  await (publishCancellation as any).handler(
    {},
    { chatId: "chat", executionId: "one:exec" },
  );
  expect(mockClient.publish.mock.calls.map((call) => call[0])).toEqual([
    "stream:cancel:execution:chat%3Aone:exec",
    "stream:cancel:execution:chat:one%3Aexec",
  ]);
});
