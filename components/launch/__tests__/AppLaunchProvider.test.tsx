import { act, render, screen } from "@testing-library/react";
let mockPathname = "/";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
import {
  AppLaunchComplete,
  AppLaunchFallback,
  AppLaunchProvider,
} from "../AppLaunchProvider";

function Fixture({ loading }: { loading: boolean }) {
  return (
    <AppLaunchProvider>
      {loading ? (
        <AppLaunchFallback />
      ) : (
        <>
          <AppLaunchComplete />
          <input aria-label="Draft" />
        </>
      )}
    </AppLaunchProvider>
  );
}

describe("app startup lifecycle", () => {
  beforeEach(() => {
    mockPathname = "/";
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it("hands off as soon as the app mounts, with no minimum splash duration", () => {
    const { rerender } = render(<Fixture loading />);
    expect(screen.getByRole("heading", { name: "RIFT" })).toBeVisible();
    expect(screen.getByText(/Recursive Intelligence/)).toHaveTextContent(
      "Recursive Intelligence for Technology",
    );
    rerender(<Fixture loading={false} />);
    expect(screen.getByRole("textbox", { name: "Draft" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "RIFT" }),
    ).not.toBeInTheDocument();
    // Radix defers its focus-scope cleanup by one microtask-sized timer.
    act(() => jest.advanceTimersByTime(0));
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not replay the brand screen on a later route load or reconnect", () => {
    const { rerender } = render(<Fixture loading />);
    rerender(<Fixture loading={false} />);
    rerender(<Fixture loading />);
    expect(
      screen.queryByRole("heading", { name: "RIFT" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
  });

  it("offers recovery for a stalled startup and still yields when the app is ready", () => {
    const { rerender } = render(<Fixture loading />);
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(20000));
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Taking longer than expected",
    );
    rerender(<Fixture loading={false} />);
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("does not introduce a startup screen when entering chat from another page", () => {
    mockPathname = "/login";
    const { rerender } = render(<Fixture loading />);
    mockPathname = "/";
    rerender(<Fixture loading />);
    expect(
      screen.queryByRole("heading", { name: "RIFT" }),
    ).not.toBeInTheDocument();
    mockPathname = "/login";
    rerender(<Fixture loading />);
    expect(
      screen.queryByRole("heading", { name: "RIFT" }),
    ).not.toBeInTheDocument();
  });

  it("contains keyboard focus while the first shell is covered", () => {
    render(
      <AppLaunchProvider>
        <button>Background menu</button>
        <AppLaunchFallback />
      </AppLaunchProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Opening RIFT" })).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: "Background menu" }),
    ).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(20000));
    screen.getByRole("button", { name: "Try again" }).focus();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
  });
});
