import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { AGENT_START_TIMEOUT_MESSAGE } from "@/lib/chat/interrupted-response";
import { ChatSDKError } from "@/lib/errors";
import { MessageErrorState } from "../MessageErrorState";

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({ subscription: "pro" }),
}));

describe("MessageErrorState Agent startup recovery", () => {
  it("keeps the timeout visible with both reconnect and retry actions", () => {
    const onReconnect = jest.fn();
    const onRetry = jest.fn();

    render(
      <MessageErrorState
        error={new Error(AGENT_START_TIMEOUT_MESSAGE)}
        onReconnect={onReconnect}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      AGENT_START_TIMEOUT_MESSAGE,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

it("offers inspect-and-continue for uncertain work, including an error cause", () => {
  const onRetry = jest.fn();
  const error = new Error("Bad request", {
    cause: "The previous action cannot be safely replayed automatically.",
  });
  render(<MessageErrorState error={error} onRetry={onRetry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("inspect the saved work");
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Inspect and continue" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("allows retry after temporary provider in-flight capacity clears", () => {
  const onRetry = jest.fn();
  render(
    <MessageErrorState
      error={
        new Error(
          "This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.",
        )
      }
      onRetry={onRetry}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "temporarily at capacity",
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "balance is exhausted",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("routes a prematurely ended provider stream through reconciliation", () => {
  render(
    <MessageErrorState
      error={
        new Error(
          JSON.stringify({
            code: 502,
            message: "Stream ended before a terminal response event",
            metadata: { error_type: "provider_unavailable" },
          }),
        )
      }
      onRetry={jest.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Inspect and continue" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "provider_unavailable",
  );
});

it.each([
  "Your included credits are used up and your add-on balance cannot cover this request. Add credits in Settings to continue.",
  "Auto-reload couldn't add credits (payment_failed). Update your payment method, then try again.",
])(
  "preserves account rate-limit errors instead of blaming provider funding: %s",
  (message) => {
    render(
      <MessageErrorState
        error={new ChatSDKError("rate_limit:chat", message)}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(
      screen.queryByTestId("provider-credits-exhausted"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View Usage" }),
    ).toBeInTheDocument();
  },
);

it("keeps genuine provider funding errors separate from account limits", () => {
  render(
    <MessageErrorState
      error={
        new Error("Insufficient credits. Add credits to your provider account.")
      }
      onRetry={jest.fn()}
    />,
  );
  expect(screen.getByTestId("provider-credits-exhausted")).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "View Usage" }),
  ).not.toBeInTheDocument();
});

it.each([
  "Your included credits are used up and your add-on balance cannot cover this request. Add credits in Settings to continue.",
  "Auto-reload couldn't add credits (payment_failed). Update your payment method, then try again.",
  "You've hit your usage limit and your extra usage balance is empty. Add credits in Settings.",
])("keeps plain SDK account errors out of provider funding: %s", (message) => {
  render(<MessageErrorState error={new Error(message)} onRetry={jest.fn()} />);
  expect(
    screen.queryByTestId("provider-credits-exhausted"),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(message);
  expect(screen.getByRole("link", { name: "View Usage" })).toBeInTheDocument();
});

it("offers inspection instead of replay for a reloaded interrupted response", () => {
  const { INTERRUPTED_RESPONSE_MESSAGE } = jest.requireActual(
    "@/lib/chat/interrupted-response",
  );
  render(
    <MessageErrorState
      error={new Error(INTERRUPTED_RESPONSE_MESSAGE)}
      onRetry={jest.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Inspect and continue" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
});
