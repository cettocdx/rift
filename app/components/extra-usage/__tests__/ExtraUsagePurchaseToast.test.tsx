import "@testing-library/jest-dom";
import { cleanup, render, waitFor } from "@testing-library/react";

import { ExtraUsagePurchaseToast } from "../ExtraUsagePurchaseToast";

const mockToastInfo = jest.fn();
const mockToastSuccess = jest.fn();

jest.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("ExtraUsagePurchaseToast", () => {
  it("shows and clears LemonSqueezy pending feedback", async () => {
    const historyState = { route: "preserved" };
    window.history.replaceState(
      historyState,
      "",
      "/?tokens-pending=1&source=billing",
    );

    render(<ExtraUsagePurchaseToast />);

    await waitFor(() =>
      expect(mockToastInfo).toHaveBeenCalledWith("Payment submitted", {
        description:
          "Your add-on credits will appear as soon as LemonSqueezy confirms the payment.",
      }),
    );
    expect(window.location.search).toBe("?source=billing");
    expect(window.history.state).toEqual(historyState);
  });

  it("supports a confirmed-credit return state", async () => {
    window.history.replaceState({}, "", "/?tokens-success=1");

    render(<ExtraUsagePurchaseToast />);

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith("Credits added", {
        description: "Your add-on credit balance is ready to use.",
      }),
    );
    expect(window.location.search).toBe("");
  });
});
