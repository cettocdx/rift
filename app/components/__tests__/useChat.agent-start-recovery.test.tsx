import "@testing-library/jest-dom";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Response as EdgeResponse } from "next/dist/compiled/@edge-runtime/primitives/fetch";
import { TextDecoderStream } from "node:stream/web";
import { AGENT_START_TIMEOUT_MESSAGE } from "@/lib/chat/interrupted-response";

const failedAgentResponse = () =>
  new Response(
    new TextEncoder().encode(
      `data: ${JSON.stringify({
        type: "error",
        errorText: AGENT_START_TIMEOUT_MESSAGE,
      })}\n\n`,
    ),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );

function AgentStartRecoveryHarness({
  transport,
}: {
  transport: DefaultChatTransport;
}) {
  const { messages, sendMessage, regenerate, status, error } = useChat({
    id: "new-build-chat",
    transport,
  });

  const text = messages.flatMap((message) =>
    message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => void sendMessage({ text: "Build a polished dashboard" })}
      >
        Send
      </button>
      {error ? (
        <button type="button" onClick={() => void regenerate()}>
          Retry
        </button>
      ) : null}
      <output data-testid="status">{status}</output>
      <div data-testid="turns">{text.join("\n")}</div>
      {error ? <div role="alert">{error.message}</div> : null}
    </div>
  );
}

describe("useChat Agent startup recovery", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "Response", {
      configurable: true,
      value: EdgeResponse,
    });
    Object.defineProperty(globalThis, "TextDecoderStream", {
      configurable: true,
      value: TextDecoderStream,
    });
    if (typeof globalThis.structuredClone === "function") return;
    Object.defineProperty(globalThis, "structuredClone", {
      configurable: true,
      value: <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    });
  });

  it("retains the optimistic user turn after timeout and resends it on retry", async () => {
    const fetch = jest.fn(async () => failedAgentResponse());
    const transport = new DefaultChatTransport({ fetch });

    render(<AgentStartRecoveryHarness transport={transport} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("error"),
    );
    expect(screen.getByTestId("turns")).toHaveTextContent(
      "Build a polished dashboard",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      AGENT_START_TIMEOUT_MESSAGE,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("turns")).toHaveTextContent(
      "Build a polished dashboard",
    );
  });
});
