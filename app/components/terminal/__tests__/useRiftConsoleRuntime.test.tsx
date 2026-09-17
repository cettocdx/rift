import { act, cleanup, renderHook } from "@testing-library/react";
import { useRiftConsoleRuntime } from "../useRiftConsoleRuntime";
let mockAuth: { user: { id: string } | null; loading: boolean };
const mockClients: any[] = [];
const mockMainController = jest.fn(() => {
  throw new Error("Terminal must not use the main chat");
});
jest.mock("../RiftAgentConsoleContext", () => ({
  useOptionalRiftAgentConsole: () => mockMainController(),
}));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => mockMainController(),
}));
jest.mock("@/app/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
jest.mock("@/packages/console/src/independent-client", () => ({
  IndependentConsoleClient: class {
    snapshot: any;
    initialize = jest.fn(async () => {});
    send = jest.fn(async () => {});
    close = jest.fn();
    subscribe = () => () => {};
    getSnapshot = () => this.snapshot;
    constructor(
      _: unknown,
      id: string | undefined,
      remember: (id: string) => void,
    ) {
      this.snapshot = {
        chatId: id ?? `terminal-${mockClients.length}`,
        status: "ready",
        entries: [],
      };
      remember(this.snapshot.chatId);
      mockClients.push(this);
    }
  },
}));
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn() as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});
beforeEach(() => {
  mockAuth = { user: { id: `owner-${mockClients.length}` }, loading: false };
  localStorage.clear();
  mockMainController.mockClear();
});
afterEach(cleanup);
it("dispatches through the independent session without touching main composer or navigation", async () => {
  const { result } = renderHook(useRiftConsoleRuntime);
  const client = mockClients.at(-1);
  const command = {
    type: "submit" as const,
    chatId: client.snapshot.chatId,
    text: "Console task",
  };
  await act(async () => {
    expect(await result.current.onCommand(command)).toEqual({ accepted: true });
  });
  expect(client.send).toHaveBeenCalledWith(command);
  expect(mockMainController).not.toHaveBeenCalled();
});
it("keeps the same live client when the dock or route unmounts", () => {
  const first = renderHook(useRiftConsoleRuntime);
  const client = mockClients.at(-1);
  first.unmount();
  const count = mockClients.length;
  const next = renderHook(useRiftConsoleRuntime);
  expect(mockClients.length).toBe(count);
  expect(next.result.current.snapshot.chatId).toBe(client.snapshot.chatId);
  expect(client.close).not.toHaveBeenCalled();
  expect(client.initialize).toHaveBeenCalledTimes(1);
});
it("restores only the current account terminal ID", () => {
  localStorage.setItem(
    `rift:terminal:independent:session:${mockAuth.user!.id}`,
    "saved-terminal",
  );
  const { result } = renderHook(useRiftConsoleRuntime);
  expect(result.current.snapshot.chatId).toBe("saved-terminal");
});
it("closes the previous account reader and cannot expose its transcript after sign out", async () => {
  const { result, rerender } = renderHook(useRiftConsoleRuntime);
  const previous = mockClients.at(-1);
  mockAuth = { user: null, loading: false };
  rerender();
  expect(previous.close).toHaveBeenCalledTimes(1);
  expect(result.current.snapshot.chatId).toBeNull();
  expect(await result.current.onCommand({ type: "new-chat" })).toEqual({
    accepted: false,
    error: "Sign in to use RIFT Terminal.",
  });
});
it("waits for authentication before creating a client", () => {
  mockAuth.loading = true;
  const count = mockClients.length;
  const { result } = renderHook(useRiftConsoleRuntime);
  expect(mockClients.length).toBe(count);
  expect(result.current.snapshot.status).toBe("unavailable");
});
it("reports an uncertain submission without retrying it", async () => {
  const { result } = renderHook(useRiftConsoleRuntime);
  const client = mockClients.at(-1);
  client.send.mockRejectedValue(new Error("Connection interrupted"));
  expect(
    await result.current.onCommand({
      type: "submit",
      chatId: client.snapshot.chatId,
      text: "task",
    }),
  ).toEqual({ accepted: false, error: "Connection interrupted" });
  expect(client.send).toHaveBeenCalledTimes(1);
});

it("reopening a failed console retries the same saved session", () => {
  const first = renderHook(useRiftConsoleRuntime);
  const client = mockClients.at(-1);
  const chatId = client.snapshot.chatId;
  first.unmount();
  client.snapshot = { ...client.snapshot, status: "error" };
  const reopened = renderHook(useRiftConsoleRuntime);
  expect(mockClients.at(-1)).toBe(client);
  expect(reopened.result.current.snapshot.chatId).toBe(chatId);
  expect(client.initialize).toHaveBeenCalledTimes(2);
  expect(client.send).not.toHaveBeenCalled();
});

it("recovers a failed reader when the network returns without interrupting a live task", () => {
  const hook = renderHook(useRiftConsoleRuntime);
  const client = mockClients.at(-1);
  client.snapshot = { ...client.snapshot, status: "streaming" };
  act(() => window.dispatchEvent(new Event("online")));
  expect(client.initialize).toHaveBeenCalledTimes(1);
  client.snapshot = { ...client.snapshot, status: "error" };
  act(() => window.dispatchEvent(new Event("online")));
  expect(client.initialize).toHaveBeenCalledTimes(2);
  expect(client.send).not.toHaveBeenCalled();
  hook.unmount();
  act(() => window.dispatchEvent(new Event("online")));
  expect(client.initialize).toHaveBeenCalledTimes(2);
});
