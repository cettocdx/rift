import { render, screen } from "@testing-library/react";
import { AssistantCompletionAnnouncer } from "../AssistantCompletionAnnouncer";
import type { ChatMessage, ChatStatus } from "@/types";

const userMessage = (id: string): ChatMessage =>
  ({
    id,
    role: "user",
    parts: [{ type: "text", text: "Build it" }],
  }) as ChatMessage;

const assistantMessage = (id: string): ChatMessage =>
  ({
    id,
    role: "assistant",
    parts: [{ type: "text", text: "Done" }],
  }) as ChatMessage;

describe("AssistantCompletionAnnouncer", () => {
  it("politely announces a response when streaming becomes ready", () => {
    const firstTurn = [userMessage("user-1")];
    const completedTurn = [...firstTurn, assistantMessage("assistant-1")];
    const { rerender } = render(
      <AssistantCompletionAnnouncer
        messages={firstTurn}
        status={"streaming" as ChatStatus}
      />,
    );

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveAttribute("aria-atomic", "true");
    expect(liveRegion).toBeEmptyDOMElement();

    rerender(
      <AssistantCompletionAnnouncer
        messages={completedTurn}
        status={"ready" as ChatStatus}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "RIFT response complete.",
    );
  });

  it("waits for completed assistant content without announcing loaded history", () => {
    const currentUser = userMessage("user-current");
    const { rerender } = render(
      <AssistantCompletionAnnouncer
        messages={[assistantMessage("assistant-history"), currentUser]}
        status={"ready" as ChatStatus}
      />,
    );

    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    rerender(
      <AssistantCompletionAnnouncer
        messages={[currentUser]}
        status={"submitted" as ChatStatus}
      />,
    );
    rerender(
      <AssistantCompletionAnnouncer
        messages={[currentUser]}
        status={"ready" as ChatStatus}
      />,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    rerender(
      <AssistantCompletionAnnouncer
        messages={[currentUser, assistantMessage("assistant-current")]}
        status={"ready" as ChatStatus}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "RIFT response complete.",
    );
  });

  it("does not announce another chat's history after an unfinished response", () => {
    const { rerender } = render(
      <AssistantCompletionAnnouncer
        messages={[userMessage("user-abandoned")]}
        status={"submitted" as ChatStatus}
      />,
    );

    rerender(
      <AssistantCompletionAnnouncer
        messages={[assistantMessage("assistant-other-chat")]}
        status={"ready" as ChatStatus}
      />,
    );

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says the response was stopped, not completed, when the user stopped it", () => {
    // Stop and a natural finish both land on `ready`. Announcing "complete"
    // after a cancellation tells a screen-reader user the opposite of what
    // happened, and it is the only feedback they get that Stop did anything.
    const stoppedByUserRef = { current: false };
    const firstTurn = [userMessage("user-1")];
    const partialTurn = [...firstTurn, assistantMessage("assistant-1")];
    const { rerender } = render(
      <AssistantCompletionAnnouncer
        messages={firstTurn}
        status={"streaming" as ChatStatus}
        stoppedByUserRef={stoppedByUserRef}
      />,
    );

    stoppedByUserRef.current = true;
    rerender(
      <AssistantCompletionAnnouncer
        messages={partialTurn}
        status={"ready" as ChatStatus}
        stoppedByUserRef={stoppedByUserRef}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "RIFT response stopped.",
    );
  });

  it("still announces a stop that produced no assistant text at all", () => {
    // Stopping during the thinking phase leaves the user message last. The
    // completion path bails out there, which would leave the stop silent.
    const stoppedByUserRef = { current: false };
    const turn = [userMessage("user-1")];
    const { rerender } = render(
      <AssistantCompletionAnnouncer
        messages={turn}
        status={"submitted" as ChatStatus}
        stoppedByUserRef={stoppedByUserRef}
      />,
    );

    stoppedByUserRef.current = true;
    rerender(
      <AssistantCompletionAnnouncer
        messages={turn}
        status={"ready" as ChatStatus}
        stoppedByUserRef={stoppedByUserRef}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "RIFT response stopped.",
    );
  });
});
