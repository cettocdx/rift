import { act, render, screen } from "@testing-library/react";

import Loading from "@/components/ui/loading";

describe("Loading", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("shows nothing for the first 200ms so fast loads never flash a spinner", () => {
    const { container } = render(<Loading />);

    // The status region exists from the first frame — screen readers should
    // hear "loading" even while sighted users see a calm empty box.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeNull();

    act(() => {
      jest.advanceTimersByTime(199);
    });
    expect(container.querySelector(".animate-spin")).toBeNull();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("emits a static size class Tailwind can extract", () => {
    const { container } = render(<Loading size={6} />);

    act(() => {
      jest.advanceTimersByTime(200);
    });

    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toHaveClass("size-6");
  });

  it("drops the timer on unmount rather than setting state on a dead tree", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Loading />);

    unmount();
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
