import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "@ai-sdk/react";

import { LiveReasoningViewport, ReasoningHandler } from "../ReasoningHandler";

jest.mock("../MemoizedMarkdown", () => ({
  MemoizedMarkdown: ({ content }: { content: string }) => <p>{content}</p>,
}));

function renderViewport() {
  const view = render(
    <LiveReasoningViewport streaming contentKey="first">
      <p>First reasoning lines.</p>
    </LiveReasoningViewport>,
  );
  const viewport = document.querySelector(
    '[data-ui="reasoning-live-viewport"]',
  ) as HTMLDivElement;
  let contentHeight = 300;
  let scrollTop = 200;
  Object.defineProperties(viewport, {
    scrollHeight: { get: () => contentHeight },
    clientHeight: { get: () => 100 },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, contentHeight - 100));
      },
    },
  });
  return {
    ...view,
    viewport,
    grow: () => {
      contentHeight += 120;
    },
  };
}

describe("LiveReasoningViewport", () => {
  it("follows appended text only while the reader is at the bottom", () => {
    const { viewport, grow, rerender } = renderViewport();
    grow();
    rerender(
      <LiveReasoningViewport streaming contentKey="second">
        <p>More reasoning.</p>
      </LiveReasoningViewport>,
    );
    expect(viewport.scrollTop).toBe(320);

    viewport.scrollTop = 40;
    fireEvent.scroll(viewport);
    expect(viewport).toHaveAttribute("data-following", "false");
    grow();
    rerender(
      <LiveReasoningViewport streaming contentKey="third">
        <p>New reasoning below the reader.</p>
      </LiveReasoningViewport>,
    );
    expect(viewport.scrollTop).toBe(40);

    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
    fireEvent.scroll(viewport);
    expect(viewport).toHaveAttribute("data-following", "true");
    grow();
    rerender(
      <LiveReasoningViewport streaming contentKey="fourth">
        <p>Following again.</p>
      </LiveReasoningViewport>,
    );
    expect(viewport.scrollTop).toBe(560);
  });

  it("keeps the same reader position and scroll container when reasoning finishes", () => {
    const { viewport, grow, rerender } = renderViewport();
    viewport.scrollTop = 45;
    fireEvent.scroll(viewport);
    grow();
    rerender(
      <LiveReasoningViewport streaming={false} contentKey="finished">
        <p>Finished reasoning.</p>
      </LiveReasoningViewport>,
    );
    expect(document.querySelector('[data-ui="reasoning-live-viewport"]')).toBe(
      viewport,
    );
    expect(viewport.scrollTop).toBe(45);
    expect(viewport).toHaveAttribute("data-streaming", "false");
    expect(viewport).toHaveAttribute("data-following", "false");
  });

  it("includes the final delta for a reader who was following the live tail", () => {
    const { viewport, grow, rerender } = renderViewport();
    grow();
    rerender(
      <LiveReasoningViewport streaming={false} contentKey="finished">
        <p>Final reasoning delta.</p>
      </LiveReasoningViewport>,
    );
    expect(viewport.scrollTop).toBe(320);
    expect(document.querySelector('[data-ui="reasoning-live-viewport"]')).toBe(
      viewport,
    );
  });
});

describe("ReasoningHandler presentation", () => {
  it.each([
    "data-agent-heartbeat",
    "data-context-usage",
    "step-start",
    "finish-step",
  ])("keeps live reasoning active when %s follows it", (type) => {
    const message = {
      id: "reasoning-with-metadata",
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "Reviewing the current files.",
          state: "streaming",
        },
        { type, data: { receivedAt: 1 } },
      ],
    } as unknown as UIMessage;
    render(
      <ReasoningHandler
        message={message}
        partIndex={0}
        status="streaming"
        isLastMessage
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-running", "true");
  });

  it("settles the disclosure when the reasoning state becomes done without a new text delta", () => {
    const message = {
      id: "reasoning-state-transition",
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "Reviewing the current files.",
          state: "streaming",
        },
      ],
    } as UIMessage;
    const { rerender } = render(
      <ReasoningHandler
        message={message}
        partIndex={0}
        status="streaming"
        isLastMessage
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-running", "true");
    rerender(
      <ReasoningHandler
        message={{
          ...message,
          parts: [{ ...message.parts[0], state: "done" }] as UIMessage["parts"],
        }}
        partIndex={0}
        status="streaming"
        isLastMessage
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-running", "false");
    expect(
      screen.queryByText("Reviewing the current files."),
    ).not.toBeInTheDocument();
  });

  it("recomputes live state when metadata is replaced by a visible next phase at the same index", () => {
    const message = {
      id: "reasoning-tail-transition",
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "Reviewing the current files.",
          state: "streaming",
        },
        { type: "data-agent-heartbeat", data: {} },
      ],
    } as unknown as UIMessage;
    const { rerender } = render(
      <ReasoningHandler
        message={message}
        partIndex={0}
        status="streaming"
        isLastMessage
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-running", "true");
    rerender(
      <ReasoningHandler
        message={{
          ...message,
          parts: [
            message.parts[0],
            { type: "text", text: "Here is the result.", state: "streaming" },
          ],
        }}
        partIndex={0}
        status="streaming"
        isLastMessage
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-running", "false");
  });

  it("keeps completed reasoning settled while later tools are streaming", () => {
    const message = {
      id: "reasoning-before-tool",
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "Reviewing the current files.",
          state: "done",
        },
        {
          type: "tool-file",
          state: "input-available",
          input: { action: "read" },
        },
      ],
    } as unknown as UIMessage;
    render(
      <ReasoningHandler
        message={message}
        partIndex={0}
        status="streaming"
        isLastMessage
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-running", "false");
  });

  it("uses the latest named visible section as the live disclosure label", () => {
    const message = {
      id: "assistant-reasoning",
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "## Mapping the current shell\nReading the visible navigation.\n",
        },
        {
          type: "reasoning",
          text: "## Verifying responsive states\nChecking mobile overflow.",
        },
      ],
    } as unknown as UIMessage;

    render(
      <>
        <ReasoningHandler
          message={message}
          partIndex={0}
          status="streaming"
          isLastMessage
        />
        <ReasoningHandler
          message={message}
          partIndex={1}
          status="streaming"
          isLastMessage
        />
      </>,
    );

    const trigger = screen.getByRole("button", {
      name: "Verifying responsive states",
    });
    expect(trigger).toHaveAttribute("data-presentation-source", "named-step");
    expect(trigger).toHaveAttribute("data-running", "true");
    expect(
      trigger.querySelector('[data-ui="reasoning-elapsed"]'),
    ).toBeInTheDocument();
    expect(
      trigger.querySelector('[data-ui="cursor-activity-glyph"]'),
    ).toHaveAttribute("data-active", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(document.querySelector('[data-ui="reasoning-copy"]')).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("uses Cursor's quiet completed summary instead of the dynamic title", () => {
    const message = {
      id: "assistant-summary",
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "Reviewing the existing component boundaries before editing.",
        },
      ],
    } as unknown as UIMessage;

    render(
      <ReasoningHandler
        message={message}
        partIndex={0}
        status="ready"
        isLastMessage
      />,
    );

    const trigger = screen.getByRole("button", { name: "Thought" });
    expect(trigger).not.toHaveAttribute("data-presentation-source");
    expect(trigger).toHaveAttribute("data-running", "false");
    // A settled thought carries no activity glyph; the chevron is the whole
    // affordance.
    expect(
      trigger.querySelector('[data-ui="cursor-activity-glyph"]'),
    ).toBeNull();
  });
});
