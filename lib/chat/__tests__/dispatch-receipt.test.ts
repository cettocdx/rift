/** @jest-environment node */
import {
  DefaultChatTransport,
  type ChatTransport,
  type UIMessageChunk,
  type PrepareSendMessagesRequest,
} from "ai";
import { RetainedChatSession } from "../retained-chat";
import {
  createDispatchReceiptMetadata,
  consumeDispatchReceiptMetadata,
} from "../dispatch-receipt";
import type { ChatMessage } from "@/types/chat";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const ticks = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function observer() {
  return { accepted: jest.fn(), failed: jest.fn() };
}
function setup(transport: ChatTransport<ChatMessage>, available = () => true) {
  return new RetainedChatSession({ id: "chat-a", transport }, available, false);
}
function stream() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  const readable = new ReadableStream<UIMessageChunk>({
    start(value) {
      controller = value;
    },
  });
  return { readable, controller };
}

it("keeps the private receipt out of serialized metadata and settles only once", () => {
  const receipt = observer();
  const original = { ordinary: "value" };
  const metadata = createDispatchReceiptMetadata(receipt, original);
  expect(JSON.stringify(metadata)).toBe("{}");
  const taken = consumeDispatchReceiptMetadata(metadata);
  expect(taken.metadata).toBe(original);
  taken.receipt?.accepted();
  taken.receipt?.failed(new Error("late"));
  consumeDispatchReceiptMetadata(metadata).receipt?.accepted();
  expect(receipt.accepted).toHaveBeenCalledTimes(1);
  expect(receipt.failed).not.toHaveBeenCalled();
  const clone = JSON.parse(JSON.stringify(metadata));
  expect(consumeDispatchReceiptMetadata(clone)).toEqual({ metadata: clone });
});

it("does not allow observer exceptions or a later acceptance to override a failed receipt", () => {
  const failed = jest.fn(() => {
    throw new Error("observer failed");
  });
  const accepted = jest.fn();
  const { receipt } = consumeDispatchReceiptMetadata(
    createDispatchReceiptMetadata({ accepted, failed }),
  );
  expect(() => receipt?.failed(new Error("network"))).not.toThrow();
  receipt?.accepted();
  expect(failed).toHaveBeenCalledTimes(1);
  expect(accepted).not.toHaveBeenCalled();
});

it("waits for the actual HTTP response, then accepts before any stream output or completion", async () => {
  const post = deferred<Response>();
  let responseController!: ReadableStreamDefaultController<Uint8Array>;
  const responseBody = new ReadableStream<Uint8Array>({
    start(value) {
      responseController = value;
    },
  });
  const fetch = jest.fn(
    (..._args: Parameters<typeof globalThis.fetch>) => post.promise,
  );
  const prepared = jest.fn(
    ({
      requestMetadata,
      body,
    }: Parameters<PrepareSendMessagesRequest<ChatMessage>>[0]) => ({
      body: { ...body, inspectedMetadata: requestMetadata },
    }),
  );
  const transport = new DefaultChatTransport<ChatMessage>({
    fetch,
    prepareSendMessagesRequest: prepared,
  });
  const session = setup(transport);
  const receipt = observer();
  const ordinary = { trace: "ordinary-metadata" };
  let finished = false;
  const sending = session
    .sendMessage(
      { text: "queued", metadata: { mode: "agent" } },
      {
        body: { mode: "agent" },
        metadata: createDispatchReceiptMetadata(receipt, ordinary),
      },
    )
    .then(() => {
      finished = true;
    });
  await ticks();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(receipt.accepted).not.toHaveBeenCalled();
  expect(receipt.failed).not.toHaveBeenCalled();
  expect(prepared.mock.calls[0][0].requestMetadata).toBe(ordinary);
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
    mode: "agent",
    inspectedMetadata: ordinary,
  });
  expect(session.chat.messages[0].metadata).toEqual({ mode: "agent" });
  post.resolve(
    new Response(responseBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
  );
  await ticks();
  expect(receipt.accepted).toHaveBeenCalledTimes(1);
  expect(finished).toBe(false);
  responseController.enqueue(
    new TextEncoder().encode('data: {"type":"finish"}\n\n'),
  );
  responseController.close();
  await sending;
  expect(receipt.failed).not.toHaveBeenCalled();
  session.dispose();
});

it("reports a rejected POST even though the real SDK resolves sendMessage after catching it", async () => {
  const error = new Error("POST rejected");
  const sendMessages = jest.fn().mockRejectedValue(error);
  const session = setup({ sendMessages, reconnectToStream: async () => null });
  const receipt = observer();
  await expect(
    session.sendMessage(
      { text: "queued" },
      { metadata: createDispatchReceiptMetadata(receipt) },
    ),
  ).resolves.toBeUndefined();
  expect(receipt.failed).toHaveBeenCalledTimes(1);
  expect(receipt.failed).toHaveBeenCalledWith(error);
  expect(receipt.accepted).not.toHaveBeenCalled();
  expect(sendMessages.mock.calls[0][0].metadata).toBeUndefined();
  session.dispose();
});

it("does not reverse acceptance or replay after a later stream failure", async () => {
  const output = stream();
  const sendMessages = jest.fn().mockResolvedValue(output.readable);
  const session = setup({ sendMessages, reconnectToStream: async () => null });
  const receipt = observer();
  const sending = session.sendMessage(
    { text: "queued" },
    { metadata: createDispatchReceiptMetadata(receipt) },
  );
  await ticks();
  expect(receipt.accepted).toHaveBeenCalledTimes(1);
  output.controller.error(new Error("stream disconnected"));
  await sending;
  expect(receipt.failed).not.toHaveBeenCalled();
  expect(sendMessages).toHaveBeenCalledTimes(1);
  session.dispose();
});

it("reports synchronous session unavailability before the SDK starts", () => {
  const sendMessages = jest.fn();
  const session = setup(
    { sendMessages, reconnectToStream: async () => null },
    () => false,
  );
  const receipt = observer();
  expect(() =>
    session.sendMessage(
      { text: "queued" },
      { metadata: createDispatchReceiptMetadata(receipt) },
    ),
  ).toThrow("no longer available");
  expect(receipt.failed).toHaveBeenCalledTimes(1);
  expect(receipt.accepted).not.toHaveBeenCalled();
  expect(sendMessages).not.toHaveBeenCalled();
  session.dispose();
});

it("reports SDK validation rejection before it reaches the transport", async () => {
  const sendMessages = jest.fn();
  const session = setup({ sendMessages, reconnectToStream: async () => null });
  const receipt = observer();
  await expect(
    session.sendMessage(
      { text: "queued", messageId: "missing" },
      { metadata: createDispatchReceiptMetadata(receipt) },
    ),
  ).rejects.toThrow("not found");
  expect(receipt.failed).toHaveBeenCalledTimes(1);
  expect(sendMessages).not.toHaveBeenCalled();
  session.dispose();
});

it("reports a failed HTTP response through the actual DefaultChatTransport", async () => {
  const fetch = jest.fn(
    async () => new Response("Request rejected", { status: 409 }),
  );
  const session = setup(new DefaultChatTransport<ChatMessage>({ fetch }));
  const receipt = observer();
  await session.sendMessage(
    { text: "queued" },
    { metadata: createDispatchReceiptMetadata(receipt) },
  );
  expect(receipt.failed).toHaveBeenCalledTimes(1);
  expect(receipt.failed.mock.calls[0][0]).toMatchObject({
    message: "Request rejected",
  });
  expect(receipt.accepted).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
  session.dispose();
});

it("reports unavailability between SDK preparation and the retained transport", async () => {
  let available = true;
  const sendMessages = jest.fn();
  const session = setup(
    { sendMessages, reconnectToStream: async () => null },
    () => available,
  );
  const receipt = observer();
  const sending = session.sendMessage(
    { text: "queued" },
    { metadata: createDispatchReceiptMetadata(receipt) },
  );
  available = false;
  await sending;
  expect(receipt.failed).toHaveBeenCalledTimes(1);
  expect(receipt.accepted).not.toHaveBeenCalled();
  expect(sendMessages).not.toHaveBeenCalled();
  session.dispose();
});

it("reports a busy reconnect before dispatch and preserves the held reconnect", async () => {
  const reconnect = deferred<ReadableStream<UIMessageChunk> | null>();
  const sendMessages = jest.fn();
  const session = setup({
    sendMessages,
    reconnectToStream: () => reconnect.promise,
  });
  const resuming = session.resumeStream();
  const receipt = observer();
  expect(() =>
    session.sendMessage(
      { text: "queued" },
      { metadata: createDispatchReceiptMetadata(receipt) },
    ),
  ).toThrow("reconnecting");
  expect(receipt.failed).toHaveBeenCalledTimes(1);
  expect(sendMessages).not.toHaveBeenCalled();
  reconnect.resolve(null);
  await resuming;
  session.dispose();
});

it("keeps acceptance bound to the captured transport across view reattachment", async () => {
  const pending = deferred<ReadableStream<UIMessageChunk>>();
  const first = {
    sendMessages: jest.fn(() => pending.promise),
    reconnectToStream: async () => null,
  };
  const second = {
    sendMessages: jest.fn(),
    reconnectToStream: async () => null,
  };
  const session = setup(first);
  const owner = Symbol("first view");
  session.attach(owner, { transport: first });
  const receipt = observer();
  const sending = session.sendMessage(
    { text: "queued" },
    { metadata: createDispatchReceiptMetadata(receipt) },
  );
  await ticks();
  session.detach(owner);
  session.attach(Symbol("replacement view"), { transport: second });
  const output = stream();
  pending.resolve(output.readable);
  await ticks();
  expect(receipt.accepted).toHaveBeenCalledTimes(1);
  expect(second.sendMessages).not.toHaveBeenCalled();
  output.controller.enqueue({ type: "finish" });
  output.controller.close();
  await sending;
  expect(receipt.failed).not.toHaveBeenCalled();
  session.dispose();
});

it("keeps consuming an accepted stream even when the receipt observer throws", async () => {
  const output = stream();
  const session = setup({
    sendMessages: async () => output.readable,
    reconnectToStream: async () => null,
  });
  const receipt = {
    accepted: jest.fn(() => {
      throw new Error("observer bug");
    }),
    failed: jest.fn(),
  };
  const sending = session.sendMessage(
    { text: "queued" },
    { metadata: createDispatchReceiptMetadata(receipt) },
  );
  await ticks();
  output.controller.enqueue({ type: "finish" });
  output.controller.close();
  await sending;
  expect(session.chat.status).toBe("ready");
  expect(receipt.accepted).toHaveBeenCalledTimes(1);
  expect(receipt.failed).not.toHaveBeenCalled();
  session.dispose();
});
