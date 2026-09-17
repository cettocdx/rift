import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../reasoning";

describe("Reasoning", () => {
  it("keeps completed reasoning collapsed until the user opens it", () => {
    render(
      <Reasoning>
        <ReasoningTrigger />
        <ReasoningContent>Completed reasoning</ReasoningContent>
      </Reasoning>,
    );

    const trigger = screen.getByRole("button", { name: /^thought$/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Completed reasoning")).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Completed reasoning")).toBeVisible();
  });

  it("keeps streaming reasoning collapsed and preserves an explicit open on completion", () => {
    jest.useFakeTimers();
    let now = 1_000;
    const dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
    const { rerender } = render(
      <Reasoning isStreaming>
        <ReasoningTrigger />
        <ReasoningContent>Live reasoning</ReasoningContent>
      </Reasoning>,
    );

    const liveTrigger = screen.getByRole("button", { name: /thinking/i });
    expect(liveTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Live reasoning")).not.toBeInTheDocument();
    fireEvent.click(liveTrigger);
    expect(liveTrigger).toHaveAttribute("aria-expanded", "true");
    expect(liveTrigger).toHaveTextContent("0s");
    expect(
      liveTrigger.querySelector('[data-ui="cursor-activity-glyph"]'),
    ).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Live reasoning")).toBeVisible();
    const liveContent = screen
      .getByText("Live reasoning")
      .closest('[data-ui="reasoning-content"]');
    expect(liveContent).toHaveAttribute("data-live-rail", "true");
    expect(liveContent).not.toHaveClass("border-l");
    expect(liveContent).not.toHaveClass("overflow-y-auto");

    act(() => {
      now = 3_200;
      jest.advanceTimersByTime(2_000);
    });
    rerender(
      <Reasoning isStreaming={false}>
        <ReasoningTrigger />
        <ReasoningContent>Live reasoning</ReasoningContent>
      </Reasoning>,
    );

    const completedTrigger = screen.getByRole("button", {
      name: /thought 2s/i,
    });
    expect(completedTrigger).toHaveAttribute("aria-expanded", "true");
    // No glyph once it has settled. The mark used to stay as a diamond in front
    // of every collapsed thought for the life of the transcript, decorating a
    // line whose chevron already says it can be opened.
    expect(
      completedTrigger.querySelector('[data-ui="cursor-activity-glyph"]'),
    ).toBeNull();
    expect(screen.getByText("Live reasoning")).toBeVisible();
    fireEvent.click(completedTrigger);
    expect(screen.queryByText("Live reasoning")).not.toBeInTheDocument();

    dateNowSpy.mockRestore();
    jest.useRealTimers();
  });

  it("prevents long formatted reasoning text from creating page-width overflow", () => {
    render(
      <Reasoning open>
        <ReasoningTrigger />
        <ReasoningContent>
          <p>
            So using that, we can reverse-engineer:{" "}
            <code>53‡‡†305))6*;4826)4‡.)4‡);806*;48†8¶60))85</code>
          </p>
        </ReasoningContent>
      </Reasoning>,
    );

    const content = screen.getByText(/So using that/).closest("[data-state]");

    expect(content).not.toHaveClass("overflow-y-auto");
    expect(content).toHaveClass("break-words");
    expect(content).toHaveClass("[overflow-wrap:anywhere]");
    expect(content).toHaveAttribute("data-live-rail", "false");
    // Completed reasoning keeps the same unboxed layout as streaming prose.
    expect(content).not.toHaveClass("border-l");
    expect(content).not.toHaveClass("pl-3");
    // Thinking is prose and is set in the UI face; inline code inside it still
    // takes the mono variant through the renderer's own `[&_code]` rule.
    expect(content).not.toHaveClass("font-mono");
  });

  it("keeps the quiet summary before its trailing disclosure chevron", () => {
    const { container } = render(
      <Reasoning>
        <ReasoningTrigger />
        <ReasoningContent>Completed reasoning</ReasoningContent>
      </Reasoning>,
    );

    const trigger = screen.getByRole("button", { name: /^thought$/i });
    const chevron = container.querySelector('[data-ui="reasoning-chevron"]');

    expect(trigger.lastElementChild).toBe(chevron);
    expect(trigger).toHaveClass("font-normal");
  });

  it("uses a custom public progress title only while streaming", () => {
    const getThinkingMessage = jest.fn(() => "Planning next moves");
    const { rerender } = render(
      <Reasoning isStreaming>
        <ReasoningTrigger getThinkingMessage={getThinkingMessage} />
      </Reasoning>,
    );

    expect(
      screen.getByRole("button", { name: "Planning next moves" }),
    ).toBeInTheDocument();

    rerender(
      <Reasoning isStreaming={false}>
        <ReasoningTrigger getThinkingMessage={getThinkingMessage} />
      </Reasoning>,
    );

    expect(
      screen.getByRole("button", {
        name: /^Thought(?: \d+s)?$/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Planning next moves briefly/i)).toBeNull();
  });
});
