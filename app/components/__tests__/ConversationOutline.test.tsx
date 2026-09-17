import { act, fireEvent, render, screen } from "@testing-library/react";
import { ConversationOutline } from "../ConversationOutline";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ChatMessage } from "@/types";

const originalCss = window.CSS;
const originalObserver = window.ResizeObserver;
beforeAll(() => {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
});
afterAll(() => {
  window.ResizeObserver = originalObserver;
});
beforeAll(() => {
  Object.defineProperty(window, "CSS", {
    configurable: true,
    value: { ...window.CSS, escape: (value: string) => value },
  });
});
afterAll(() => {
  Object.defineProperty(window, "CSS", {
    configurable: true,
    value: originalCss,
  });
});
it("jumps within the conversation without scrolling the fixed composer or app shell", () => {
  const scroller = document.createElement("div");
  scroller.innerHTML =
    '<div data-message-id="first"></div><div data-message-id="second"></div>';
  scroller.scrollTop = 300;
  scroller.getBoundingClientRect = () => ({ top: 60 }) as DOMRect;
  const target = scroller.querySelector<HTMLElement>(
    '[data-message-id="second"]',
  )!;
  target.getBoundingClientRect = () => ({ top: 500 }) as DOMRect;
  scroller.scrollTo = jest.fn();
  const scrollWindow = jest
    .spyOn(window, "scrollTo")
    .mockImplementation(() => {});
  const messages = ["first", "second"].map((id) => ({
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
  })) as ChatMessage[];
  render(
    <TooltipProvider>
      <ConversationOutline
        messages={messages}
        scrollRef={{ current: scroller }}
      />
    </TooltipProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Jump to message 2: second" }),
  );
  expect(scroller.scrollTo).toHaveBeenCalledWith({
    top: 720,
    behavior: "smooth",
  });
  expect(scrollWindow).not.toHaveBeenCalled();
  scrollWindow.mockRestore();
});

it("keeps outline observers attached while only assistant output changes", () => {
  const scroller = document.createElement("div");
  scroller.innerHTML = "<div></div>";
  const scrollRef = { current: scroller };
  const users = ["one", "two"].map((id) => ({
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
  })) as ChatMessage[];
  const tree = (text: string) => (
    <TooltipProvider>
      <ConversationOutline
        scrollRef={scrollRef}
        messages={
          [
            ...users,
            { id: "reply", role: "assistant", parts: [{ type: "text", text }] },
          ] as ChatMessage[]
        }
      />
    </TooltipProvider>
  );
  const { rerender } = render(tree("First"));
  const observe = jest.spyOn(ResizeObserver.prototype, "observe");
  for (let i = 0; i < 120; i++) rerender(tree(`Delta ${i}`));
  expect(observe).not.toHaveBeenCalled();
  rerender(
    <TooltipProvider>
      <ConversationOutline
        scrollRef={scrollRef}
        messages={
          [
            ...users,
            {
              id: "new-user",
              role: "user",
              parts: [{ type: "text", text: "New question" }],
            },
          ] as ChatMessage[]
        }
      />
    </TooltipProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Jump to message 3: New question" }),
  ).toBeInTheDocument();
  expect(observe).toHaveBeenCalledTimes(1);
  observe.mockRestore();
});

it("refreshes jump labels when an existing user turn is edited", () => {
  const scrollRef = { current: null };
  const first = {
    id: "first",
    role: "user",
    parts: [{ type: "text", text: "Original request" }],
  } as ChatMessage;
  const second = {
    id: "second",
    role: "user",
    parts: [{ type: "text", text: "Follow up" }],
  } as ChatMessage;
  const tree = (user: ChatMessage) => (
    <TooltipProvider>
      <ConversationOutline scrollRef={scrollRef} messages={[user, second]} />
    </TooltipProvider>
  );
  const { rerender } = render(tree(first));
  rerender(
    tree({
      ...first,
      parts: [{ type: "text", text: "Edited request" }],
    } as ChatMessage),
  );
  expect(
    screen.getByRole("button", { name: "Jump to message 1: Edited request" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: "Jump to message 1: Original request",
    }),
  ).not.toBeInTheDocument();
});

it("bounds geometry reads when locating the active turn in a long conversation", () => {
  jest.useFakeTimers();
  const scroller = document.createElement("div");
  const content = document.createElement("div");
  scroller.append(content);
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  let geometryReads = 0;
  const messages = Array.from({ length: 200 }, (_, index) => {
    const node = document.createElement("div");
    node.dataset.messageId = `turn-${index}`;
    node.getBoundingClientRect = () => {
      geometryReads++;
      return { top: (index - 150) * 100 } as DOMRect;
    };
    content.append(node);
    return {
      id: `turn-${index}`,
      role: "user",
      parts: [{ type: "text", text: `Request ${index}` }],
    };
  }) as ChatMessage[];
  const { unmount } = render(
    <TooltipProvider>
      <ConversationOutline
        messages={messages}
        scrollRef={{ current: scroller }}
      />
    </TooltipProvider>,
  );
  act(() => jest.advanceTimersByTime(20));
  expect(
    screen.getByRole("button", { name: "Jump to message 152: Request 151" }),
  ).toHaveAttribute("aria-current", "location");
  expect(geometryReads).toBeLessThanOrEqual(10);
  unmount();
  jest.useRealTimers();
});
