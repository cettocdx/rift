import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AddOnCreditsDialog } from "../AddOnCreditsDialog";

const mockCreateTopup = jest.fn();

jest.mock("@/lib/rate-limit/token-bucket", () => ({
  POINTS_PER_DOLLAR: 10_000,
}));

jest.mock("convex/react", () => ({
  useAction: () => mockCreateTopup,
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("AddOnCreditsDialog", () => {
  it("uses a safe-area bottom sheet with one scroll container and touch-sized controls", async () => {
    const user = userEvent.setup();

    render(<AddOnCreditsDialog open onOpenChange={jest.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Add-on credits" });
    expect(dialog).toHaveClass(
      "bottom-0",
      "top-auto",
      "max-h-[calc(100dvh-env(safe-area-inset-top))]",
      "w-screen",
      "overflow-hidden",
    );
    expect(
      dialog.querySelector('[data-ui="buy-extra-usage-scroll"]'),
    ).toHaveClass(
      "overflow-y-auto",
      "overscroll-contain",
      "pb-[max(1rem,env(safe-area-inset-bottom))]",
    );
    expect(
      screen.getByRole("button", { name: "Close credit purchase" }),
    ).toHaveClass("size-11", "touch-manipulation");
    expect(screen.getByRole("button", { name: /^Starter:/ })).toHaveClass(
      "min-h-[108px]",
      "touch-manipulation",
    );

    await user.click(screen.getByRole("button", { name: "Custom amount" }));
    expect(screen.getByLabelText("Custom purchase amount")).toHaveClass(
      "h-11",
      "touch-manipulation",
    );
  });

  it("starts the shared LemonSqueezy checkout with the selected package", async () => {
    const user = userEvent.setup();
    const onCheckoutRedirect = jest.fn();
    mockCreateTopup.mockResolvedValue({
      url: "https://checkout.lemonsqueezy.com/example",
    });

    render(
      <AddOnCreditsDialog
        open
        onOpenChange={jest.fn()}
        onCheckoutRedirect={onCheckoutRedirect}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pay $50 with card" }));

    expect(mockCreateTopup).toHaveBeenCalledWith({
      amountDollars: 50,
      baseUrl: window.location.origin,
    });
    expect(onCheckoutRedirect).toHaveBeenCalledWith(
      "https://checkout.lemonsqueezy.com/example",
    );
  });

  it("announces checkout errors without closing the package picker", async () => {
    const user = userEvent.setup();
    mockCreateTopup.mockResolvedValue({
      url: null,
      error: "Top-ups are not configured.",
    });

    render(<AddOnCreditsDialog open onOpenChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Pay $50 with card" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Top-ups are not configured.",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("disables purchase controls while checkout is starting", async () => {
    const user = userEvent.setup();
    let resolveCheckout:
      | ((result: { url: null; error: string }) => void)
      | null = null;
    mockCreateTopup.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheckout = resolve;
        }),
    );

    render(<AddOnCreditsDialog open onOpenChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Pay $50 with card" }));

    expect(screen.getByRole("button", { name: "Processing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Starter:/ })).toBeDisabled();

    resolveCheckout?.({ url: null, error: "Try again" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Pay $50 with card" }),
      ).toBeEnabled(),
    );
  });
});
