import "@testing-library/jest-dom";
import { describe, it, expect, jest } from "@jest/globals";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FinishReasonNotice,
  SUPPRESSED_FINISH_REASONS,
} from "../FinishReasonNotice";
import { DataStreamProvider, useDataStream } from "../DataStreamProvider";
import { MAX_AUTO_CONTINUES } from "@/app/hooks/useAutoContinue";
import * as stopConditions from "@/lib/chat/stop-conditions";
import {
  BUDGET_EXHAUSTION_FINISH_REASON,
  DOOM_LOOP_FINISH_REASON,
} from "@/lib/chat/stop-conditions";
import type { ChatMode, ChatPurpose } from "@/types/chat";

function DataStreamSetter({
  isAutoResuming,
  autoContinueCount,
  children,
}: {
  isAutoResuming?: boolean;
  autoContinueCount?: number;
  children: React.ReactNode;
}) {
  const { setIsAutoResuming, setAutoContinueCount } = useDataStream();

  React.useEffect(() => {
    if (isAutoResuming !== undefined) setIsAutoResuming(isAutoResuming);
    if (autoContinueCount !== undefined)
      setAutoContinueCount(autoContinueCount);
  }, [
    isAutoResuming,
    autoContinueCount,
    setIsAutoResuming,
    setAutoContinueCount,
  ]);

  return <>{children}</>;
}

interface RenderNoticeProps {
  finishReason?: string;
  mode?: ChatMode;
  purpose?: ChatPurpose;
  onContinue?: () => void;
}

function renderNotice(
  props: RenderNoticeProps,
  contextOverrides?: { isAutoResuming?: boolean; autoContinueCount?: number },
) {
  return render(
    <DataStreamProvider>
      <DataStreamSetter {...contextOverrides}>
        <FinishReasonNotice {...props} />
      </DataStreamSetter>
    </DataStreamProvider>,
  );
}

describe("FinishReasonNotice", () => {
  describe("suppression cases (should render nothing)", () => {
    it.each([
      { finishReason: "length", mode: "agent" as ChatMode },
      { finishReason: "context-limit", mode: "agent" as ChatMode },
      { finishReason: "tool-calls", mode: "agent" as ChatMode },
      { finishReason: "timeout", mode: "ask" as ChatMode },
    ])(
      "returns null when isAutoResuming is true (finishReason=$finishReason, mode=$mode)",
      ({ finishReason, mode }) => {
        const { container } = renderNotice(
          { finishReason, mode },
          { isAutoResuming: true, autoContinueCount: 0 },
        );
        expect(container.innerHTML).toBe("");
      },
    );

    it.each([
      { finishReason: "context-limit" as const, autoContinueCount: 0 },
      { finishReason: "context-limit" as const, autoContinueCount: 2 },
      { finishReason: "context-limit" as const, autoContinueCount: 4 },
      { finishReason: "length" as const, autoContinueCount: 0 },
      { finishReason: "length" as const, autoContinueCount: 3 },
      { finishReason: "length" as const, autoContinueCount: 4 },
      { finishReason: "tool-calls" as const, autoContinueCount: 0 },
      { finishReason: "tool-calls" as const, autoContinueCount: 2 },
      { finishReason: "tool-calls" as const, autoContinueCount: 4 },
      { finishReason: "preemptive-timeout" as const, autoContinueCount: 0 },
    ])(
      "returns null in agent mode when autoContinueCount=$autoContinueCount < MAX for finishReason=$finishReason",
      ({ finishReason, autoContinueCount }) => {
        const { container } = renderNotice(
          { finishReason, mode: "agent" },
          { isAutoResuming: false, autoContinueCount },
        );
        expect(container.innerHTML).toBe("");
      },
    );

    it("returns null when finishReason is undefined", () => {
      const { container } = renderNotice(
        { finishReason: undefined, mode: "agent" },
        { isAutoResuming: false, autoContinueCount: MAX_AUTO_CONTINUES },
      );
      expect(container.innerHTML).toBe("");
    });

    it.each(["timeout", "preemptive-timeout"])(
      "never renders the time-limit notice for a Build agent (%s)",
      (finishReason) => {
        const { container } = renderNotice(
          { finishReason, mode: "agent", purpose: "app" },
          {
            isAutoResuming: false,
            autoContinueCount: MAX_AUTO_CONTINUES,
          },
        );

        expect(container.innerHTML).toBe("");
        expect(
          screen.queryByText(/Reached the time limit for this turn/),
        ).not.toBeInTheDocument();
      },
    );

    it("returns null for an unknown finishReason", () => {
      const { container } = renderNotice(
        { finishReason: "unknown-reason", mode: "agent" },
        { isAutoResuming: false, autoContinueCount: MAX_AUTO_CONTINUES },
      );
      expect(container.innerHTML).toBe("");
    });
  });

  describe("rendering cases (should show notice)", () => {
    it.each([
      {
        finishReason: "tool-calls",
        expectedText: "Reached the step limit for this turn",
      },
      {
        finishReason: "timeout",
        expectedText: "Reached the time limit for this turn",
      },
      {
        finishReason: "length",
        expectedText: "Reached the output limit for this turn",
      },
      {
        finishReason: "context-limit",
        expectedText: "Reached the context limit for this conversation",
      },
    ])(
      "renders notice for finishReason=$finishReason when autoContinueCount has reached MAX_AUTO_CONTINUES",
      ({ finishReason, expectedText }) => {
        renderNotice(
          { finishReason, mode: "agent" },
          { isAutoResuming: false, autoContinueCount: MAX_AUTO_CONTINUES },
        );
        expect(screen.getByText(new RegExp(expectedText))).toBeInTheDocument();
      },
    );

    it.each([
      {
        finishReason: "context-limit",
        mode: "ask" as ChatMode,
        expectedText: "Reached the context limit for this conversation",
      },
      {
        finishReason: "length",
        mode: "ask" as ChatMode,
        expectedText: "Reached the output limit for this turn",
      },
    ])(
      "renders notice for finishReason=$finishReason in $mode mode with autoContinueCount=0 (auto-continue only applies to agent mode)",
      ({ finishReason, mode, expectedText }) => {
        const { container } = renderNotice(
          { finishReason, mode },
          { isAutoResuming: false, autoContinueCount: 0 },
        );
        expect(container.innerHTML).not.toBe("");
        expect(screen.getByText(new RegExp(expectedText))).toBeInTheDocument();
      },
    );

    it("renders timeout notice in agent mode even with autoContinueCount=0 (timeout is not auto-continuable)", () => {
      renderNotice(
        { finishReason: "timeout", mode: "agent" },
        { isAutoResuming: false, autoContinueCount: 0 },
      );
      expect(
        screen.getByText(/Reached the time limit for this turn/),
      ).toBeInTheDocument();
    });
  });

  describe("Continue button", () => {
    it("does not render the Continue button when onContinue is not provided", () => {
      renderNotice(
        { finishReason: "tool-calls", mode: "agent" },
        { isAutoResuming: false, autoContinueCount: MAX_AUTO_CONTINUES },
      );
      expect(
        screen.queryByRole("button", { name: /continue/i }),
      ).not.toBeInTheDocument();
    });

    it("renders the Continue button when onContinue is provided", () => {
      const onContinue = jest.fn();
      renderNotice(
        { finishReason: "tool-calls", mode: "agent", onContinue },
        { isAutoResuming: false, autoContinueCount: MAX_AUTO_CONTINUES },
      );
      expect(
        screen.getByRole("button", { name: /continue/i }),
      ).toBeInTheDocument();
    });

    it("invokes onContinue when the button is clicked", () => {
      const onContinue = jest.fn();
      renderNotice(
        { finishReason: "tool-calls", mode: "agent", onContinue },
        { isAutoResuming: false, autoContinueCount: MAX_AUTO_CONTINUES },
      );
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
      expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it.each([
      "tool-calls",
      "timeout",
      "length",
      "context-limit",
      "preemptive-timeout",
    ])("renders the Continue button for finishReason=%s", (finishReason) => {
      const onContinue = jest.fn();
      renderNotice(
        { finishReason, mode: "agent", onContinue },
        { isAutoResuming: false, autoContinueCount: MAX_AUTO_CONTINUES },
      );
      expect(
        screen.getByRole("button", { name: /continue/i }),
      ).toBeInTheDocument();
    });
  });

  describe("correct styling", () => {
    it("renders with the expected CSS classes on the outer and inner divs", () => {
      renderNotice(
        { finishReason: "length", mode: "agent" },
        { isAutoResuming: false, autoContinueCount: MAX_AUTO_CONTINUES },
      );

      const innerDiv = screen
        .getByText(/Reached the output limit for this turn/)
        .closest("div.bg-muted");
      expect(innerDiv).toBeInTheDocument();
      expect(innerDiv).toHaveClass(
        "bg-muted",
        "text-muted-foreground",
        "rounded-lg",
        "px-2.5",
        "py-1.5",
        "text-[12px]",
        "border",
        "border-border",
      );

      const outerDiv = innerDiv?.parentElement;
      expect(outerDiv).toHaveClass("mt-2", "w-full");
    });
  });

  describe("doom loop", () => {
    const expectedText =
      /The agent stopped because it kept repeating the same action without making progress/;

    it.each([
      { mode: "agent" as ChatMode, autoContinueCount: 0 },
      { mode: "agent" as ChatMode, autoContinueCount: MAX_AUTO_CONTINUES },
      { mode: "ask" as ChatMode, autoContinueCount: 0 },
    ])(
      "renders the notice in $mode mode with autoContinueCount=$autoContinueCount (a halted loop is never auto-continued)",
      ({ mode, autoContinueCount }) => {
        renderNotice(
          { finishReason: DOOM_LOOP_FINISH_REASON, mode },
          { isAutoResuming: false, autoContinueCount },
        );
        expect(screen.getByText(expectedText)).toBeInTheDocument();
      },
    );

    it("still renders for a Build agent (only timeouts are hidden there)", () => {
      renderNotice(
        { finishReason: DOOM_LOOP_FINISH_REASON, mode: "agent", purpose: "app" },
        { isAutoResuming: false, autoContinueCount: 0 },
      );
      expect(screen.getByText(expectedText)).toBeInTheDocument();
    });

    it("offers Continue and invokes it once", () => {
      const onContinue = jest.fn();
      renderNotice(
        { finishReason: DOOM_LOOP_FINISH_REASON, mode: "agent", onContinue },
        { isAutoResuming: false, autoContinueCount: 0 },
      );
      const button = screen.getByRole("button", { name: /continue/i });
      fireEvent.click(button);
      expect(onContinue).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole("button", { name: /continue/i }),
      ).not.toBeInTheDocument();
    });

    it("respects isAutoResuming", () => {
      const { container } = renderNotice(
        { finishReason: DOOM_LOOP_FINISH_REASON, mode: "agent" },
        { isAutoResuming: true, autoContinueCount: 0 },
      );
      expect(container.innerHTML).toBe("");
    });
  });

  describe("budget exhausted", () => {
    const expectedText = /Stopped: your usage budget is exhausted/;

    it.each([
      { mode: "agent" as ChatMode, autoContinueCount: 0 },
      { mode: "ask" as ChatMode, autoContinueCount: 0 },
    ])("renders the notice in $mode mode", ({ mode, autoContinueCount }) => {
      renderNotice(
        { finishReason: BUDGET_EXHAUSTION_FINISH_REASON, mode },
        { isAutoResuming: false, autoContinueCount },
      );
      expect(screen.getByText(expectedText)).toBeInTheDocument();
    });

    it("never offers Continue, even when onContinue is provided", () => {
      const onContinue = jest.fn();
      renderNotice(
        { finishReason: BUDGET_EXHAUSTION_FINISH_REASON, mode: "agent", onContinue },
        { isAutoResuming: false, autoContinueCount: 0 },
      );
      expect(
        screen.queryByRole("button", { name: /continue/i }),
      ).not.toBeInTheDocument();
      expect(onContinue).not.toHaveBeenCalled();
    });

    it("links to the billing settings page instead", () => {
      renderNotice(
        { finishReason: BUDGET_EXHAUSTION_FINISH_REASON, mode: "agent" },
        { isAutoResuming: false, autoContinueCount: 0 },
      );
      const link = screen.getByRole("link", { name: /add credits/i });
      expect(link).toHaveAttribute("href", "/settings/billing");
    });

    it("respects isAutoResuming", () => {
      const { container } = renderNotice(
        { finishReason: BUDGET_EXHAUSTION_FINISH_REASON, mode: "agent" },
        { isAutoResuming: true, autoContinueCount: 0 },
      );
      expect(container.innerHTML).toBe("");
    });
  });

  describe("every stop condition has words", () => {
    // Any `*_FINISH_REASON` the stop-conditions module exports must either
    // render a notice or be listed in SUPPRESSED_FINISH_REASONS on purpose.
    // Otherwise a newly added stop condition halts the agent and the user
    // sees nothing, which is exactly what happened with doom-loop and budget.
    const finishReasonConstants = Object.entries(stopConditions).filter(
      (entry): entry is [string, string] =>
        entry[0].endsWith("_FINISH_REASON") && typeof entry[1] === "string",
    );

    it("finds the constants it is meant to check", () => {
      expect(finishReasonConstants.length).toBeGreaterThanOrEqual(4);
    });

    it.each(finishReasonConstants)(
      "%s (%s) renders a notice or is explicitly suppressed",
      (_name, finishReason) => {
        const { container } = renderNotice(
          // Ask mode with the auto-continue budget spent: no suppression
          // rule applies, so a blank render means the reason is unhandled.
          { finishReason, mode: "ask" },
          { isAutoResuming: false, autoContinueCount: MAX_AUTO_CONTINUES },
        );
        const rendered = container.innerHTML !== "";
        const suppressed = SUPPRESSED_FINISH_REASONS.includes(finishReason);
        expect(rendered || suppressed).toBe(true);
      },
    );

    it("does not list a reason as suppressed that also renders", () => {
      for (const reason of SUPPRESSED_FINISH_REASONS) {
        const { container, unmount } = renderNotice(
          { finishReason: reason, mode: "ask" },
          { isAutoResuming: false, autoContinueCount: MAX_AUTO_CONTINUES },
        );
        expect(container.innerHTML).toBe("");
        unmount();
      }
    });
  });
});
