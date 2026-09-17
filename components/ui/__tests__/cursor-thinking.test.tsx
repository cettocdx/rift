import { act, render, screen } from "@testing-library/react";
import {
  CursorActivityGlyph,
  CursorThinking,
  formatCursorElapsed,
} from "../cursor-thinking";

describe("CursorThinking", () => {
  afterEach(() => jest.useRealTimers());

  it("keeps the live command state descriptive", () => {
    render(<CursorThinking phase="terminal" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-phase", "terminal");
    expect(status).toHaveTextContent("Running command");
    expect(status).toHaveAttribute(
      "aria-label",
      "Running command. Streaming live terminal output",
    );
  });

  it("shows a truthful elapsed timer from the supplied generation timestamp", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-19T16:00:00.000Z"));
    const { container, unmount } = render(
      <CursorThinking phase="reasoning" startedAt={Date.now() - 1_250} />,
    );

    // A stable, literal phase avoids random language during long-running work.
    const phase = container.querySelector('[data-ui="live-agent-phase"]');
    expect(phase).toHaveTextContent("Thinking");
    expect(screen.getByText("1s")).toBeInTheDocument();

    act(() => jest.advanceTimersByTime(800));
    expect(screen.getByText("1s")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByText("2s")).toBeInTheDocument();
    expect(container.querySelector("time")).toHaveAttribute("dateTime", "PT2S");

    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("marks live work with the shared sidebar indicator and hides it from assistive technology", () => {
    const { container } = render(<CursorThinking phase="working" />);
    let glyph = container.querySelector('[data-ui="cursor-activity-glyph"]');

    expect(glyph).toHaveAttribute("data-active", "true");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    const orb = glyph?.querySelector('[data-ui="rift-reasoning-orb"]');
    expect(orb).toHaveAttribute("viewBox", "0 0 16 16");
    expect(orb).toHaveAttribute("focusable", "false");
    expect(glyph).toHaveTextContent("");
  });

  it("uses no JavaScript spinner timer and changes to an outline check when settled", () => {
    jest.useFakeTimers();
    const { container, rerender } = render(<CursorActivityGlyph active />);
    let glyph = container.querySelector('[data-ui="cursor-activity-glyph"]');
    expect(glyph?.querySelectorAll("circle")).toHaveLength(6);
    expect(glyph?.querySelectorAll("path")).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(glyph?.querySelectorAll("circle")).toHaveLength(6);

    rerender(<CursorActivityGlyph active={false} />);
    glyph = container.querySelector('[data-ui="cursor-activity-glyph"]');
    expect(glyph).toHaveAttribute("data-active", "false");
    expect(glyph).toHaveAttribute("fill", "none");
    expect(glyph?.querySelectorAll("[data-orb-frame]")).toHaveLength(0);
    expect(glyph?.querySelector("path")).toHaveAttribute(
      "d",
      "m3.25 7 2.5 2.5 5-5",
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it("keeps elapsed and trailing counter updates out of the live announcement", () => {
    jest.useFakeTimers();
    const { container, rerender } = render(
      <CursorThinking title="Reading api.d.ts" trailing="200 tokens" />,
    );
    const status = screen.getByRole("status", { name: "Reading api.d.ts" });
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(
      container.querySelector('[data-ui="live-agent-elapsed"]'),
    ).toHaveAttribute("aria-hidden", "true");
    expect(
      container.querySelector('[data-ui="live-agent-trailing"]'),
    ).toHaveAttribute("aria-hidden", "true");
    act(() => jest.advanceTimersByTime(3000));
    expect(status).toHaveAttribute("aria-label", "Reading api.d.ts");
    rerender(<CursorThinking title="Awaiting model preference" />);
    expect(
      screen.getByRole("status", { name: "Awaiting model preference" }),
    ).toBeInTheDocument();
  });

  it("retains elapsed time when the visible activity changes", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-07T18:00:00Z"));
    const { rerender } = render(<CursorThinking title="Reading api.d.ts" />);
    act(() => jest.advanceTimersByTime(65_000));
    rerender(<CursorThinking title="Awaiting model preference" />);
    expect(screen.getByText("1m 05s")).toBeInTheDocument();
  });

  it("keeps the startup label stable while connecting", () => {
    const { rerender } = render(<CursorThinking phase="starting" />);
    expect(screen.getByRole("status")).toHaveTextContent("Working");
    expect(screen.getByRole("status")).not.toHaveTextContent(
      /starting|connecting/i,
    );

    rerender(<CursorThinking phase="connecting" />);
    expect(screen.getByRole("status")).toHaveTextContent("Working");
  });

  it("renders a public event-derived title and source", () => {
    render(
      <CursorThinking
        phase="working"
        title="Selecting project skills"
        ariaLabel="Selecting project skills. Live agent activity"
        source="tool"
      />,
    );

    const status = screen.getByRole("status", {
      name: "Selecting project skills. Live agent activity",
    });
    expect(status).toHaveTextContent("Selecting project skills");
    expect(status).toHaveAttribute("data-progress-source", "tool");
    expect(status).toHaveAttribute(
      "aria-label",
      "Selecting project skills. Live agent activity",
    );
  });

  it("keeps long durations compact", () => {
    expect(formatCursorElapsed(9_950)).toBe("9.9s");
    expect(formatCursorElapsed(12_900)).toBe("12s");
    expect(formatCursorElapsed(65_900)).toBe("1m 05s");
  });
});
