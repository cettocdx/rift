import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { useNewChatMessage } from "../useNewChatMessage";
import { queueNewChatMessage } from "@/lib/utils/new-chat-message";

const replace = jest.fn();
let searchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ replace }),
}));

beforeEach(() => {
  replace.mockClear();
  searchParams = new URLSearchParams();
});

it("waits for the new Build to be ready and submits the saved mention exactly once", () => {
  const href = queueNewChatMessage("@agent:buddy Review the available tools");
  searchParams = new URLSearchParams(href.split("?")[1]);
  const onSubmit = jest.fn();
  const { rerender } = renderHook(
    ({ ready }) => useNewChatMessage({ ready, onSubmit }),
    { initialProps: { ready: false }, wrapper: StrictMode },
  );

  expect(onSubmit).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  rerender({ ready: true });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith(expect.anything(), {
    input: "@agent:buddy Review the available tools",
    mode: "agent",
    isolated: true,
  });
  expect(replace).toHaveBeenCalledWith("/", { scroll: false });
  rerender({ ready: false });
  rerender({ ready: true });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("never delivers a queued test to an unrelated new chat", () => {
  queueNewChatMessage("@agent:buddy This belongs to a specific navigation");
  const onSubmit = jest.fn();
  const { rerender } = renderHook(() =>
    useNewChatMessage({ ready: true, onSubmit }),
  );
  searchParams = new URLSearchParams("agentTest=unrelated");
  rerender();
  expect(onSubmit).not.toHaveBeenCalled();
});
