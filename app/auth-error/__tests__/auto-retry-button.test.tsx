import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { AutoRetryButton } from "../auto-retry-button";

describe("AutoRetryButton", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("labels the countdown control for the cancel action it performs", () => {
    render(<AutoRetryButton loginUrl="/login" />);

    const cancel = screen.getByRole("button", {
      name: "Cancel automatic retry",
    });
    expect(cancel).toHaveTextContent("Cancel retry (5s)");

    fireEvent.click(cancel);

    expect(screen.getByRole("link", { name: /Try Again/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("keeps the visible countdown current", () => {
    render(<AutoRetryButton loginUrl="/login" />);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(
      screen.getByRole("button", { name: "Cancel automatic retry" }),
    ).toHaveTextContent("Cancel retry (4s)");
  });
});
