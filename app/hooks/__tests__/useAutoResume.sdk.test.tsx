import { useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import type { ChatTransport, UIMessageChunk } from "ai";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataStreamProvider } from "@/app/components/DataStreamProvider";
import { prepareMessagesForAgentReplay } from "@/lib/chat/agent-replay";
import type { ChatMessage } from "@/types/chat";
import { useAutoResume } from "../useAutoResume";

beforeAll(() => {
  if (typeof globalThis.structuredClone !== "function") {
    Object.defineProperty(globalThis, "structuredClone", { configurable: true, value: <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T });
  }
});

it("waits for the real SDK response finalizer before replay and produces one complete answer", async () => {
  const order: string[] = [];
  let releaseOldReader!: () => void;
  let prepareReplay!: () => void;
  const sendMessages = jest.fn(async ({ abortSignal }: Parameters<ChatTransport<ChatMessage>["sendMessages"]>[0]) => new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "start", messageId: "run_one" });
      controller.enqueue({ type: "text-start", id: "text" });
      controller.enqueue({ type: "text-delta", id: "text", delta: "Hello" });
      abortSignal?.addEventListener("abort", () => {
        order.push("abort-requested");
        releaseOldReader = () => controller.error(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    },
  }));
  const reconnectToStream = jest.fn(async () => {
    order.push("reconnect");
    prepareReplay();
    return new ReadableStream<UIMessageChunk>({ start(controller) {
      controller.enqueue({ type: "start", messageId: "run_one" });
      controller.enqueue({ type: "text-start", id: "text" });
      controller.enqueue({ type: "text-delta", id: "text", delta: "Hello world" });
      controller.enqueue({ type: "text-end", id: "text" });
      controller.enqueue({ type: "finish" });
      controller.close();
    } });
  });
  const transport: ChatTransport<ChatMessage> = { sendMessages, reconnectToStream };
  function Harness() {
    const chat = useChat<ChatMessage>({ id: "chat_one", transport,
      onFinish: ({ isAbort }) => { order.push(isAbort ? "old-finished" : "new-finished"); },
    });
    const latest = useRef(chat);
    useEffect(() => { latest.current = chat; }, [chat]);
    useEffect(() => {
      prepareReplay = () => latest.current.setMessages(prepareMessagesForAgentReplay(latest.current.messages, "run_one"));
    }, []);
    const recoveryPending = useAutoResume({ autoResume: false, initialMessages: [], hasActiveStream: true,
      resumeStream: chat.resumeStream, stopReader: chat.stop, setMessages: chat.setMessages, status: chat.status,
    });
    return <>
      <button onClick={() => void chat.sendMessage({ text: "Build" })}>Send</button>
      <output data-testid="status">{chat.status}</output>
      <output data-testid="recovering">{String(recoveryPending)}</output>
      <output data-testid="answer">{chat.messages.filter((m) => m.role === "assistant").flatMap((m) => m.parts.map((p) => p.type === "text" ? p.text : "")).join("|")}</output>
    </>;
  }
  render(<DataStreamProvider><Harness /></DataStreamProvider>);
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(screen.getByTestId("answer")).toHaveTextContent("Hello"));
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(order).toContain("abort-requested"));
  expect(reconnectToStream).not.toHaveBeenCalled();
  await act(async () => releaseOldReader());
  await waitFor(() => expect(screen.getByTestId("answer").textContent).toBe("Hello world"));
  expect(order).toEqual(["abort-requested", "old-finished", "reconnect", "new-finished"]);
  expect(sendMessages).toHaveBeenCalledTimes(1);
  expect(reconnectToStream).toHaveBeenCalledTimes(1);
});
