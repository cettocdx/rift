import React, { useLayoutEffect } from "react";
import { render, screen } from "@testing-library/react";
import {
  ChatViewStateProvider,
  useChatViewState,
} from "../ChatViewStateContext";

function Chat({ id }: { id: string }) {
  const view = useChatViewState(id);
  const restored = view.scroll?.top;
  useLayoutEffect(() => {
    // This hook exposes an imperative memory cache, not React render state.
    // eslint-disable-next-line react-hooks/immutability
    view.title = `Title ${id}`;
    view.loadedMessageCount = 42;
    view.scroll = { top: 380, atBottom: false };
  }, [view, id]);
  return (
    <output>
      {restored === undefined
        ? "new"
        : `${view.title}:${restored}:${view.loadedMessageCount}`}
    </output>
  );
}

function Shell({ page, account = "a" }: { page: string; account?: string }) {
  return (
    <ChatViewStateProvider key={account}>
      {page === "studio" ? <p>Studio</p> : <Chat key={page} id={page} />}
    </ChatViewStateProvider>
  );
}

it("restores the scroll and loaded history on the first render after returning from Studio", () => {
  const { rerender } = render(<Shell page="chat-a" />);
  expect(screen.getByText("new")).toBeInTheDocument();
  rerender(<Shell page="studio" />);
  rerender(<Shell page="chat-a" />);
  expect(screen.getByText("Title chat-a:380:42")).toBeInTheDocument();
});

it("keeps each conversation isolated and discards state on account changes", () => {
  const { rerender } = render(<Shell page="chat-a" />);
  rerender(<Shell page="chat-b" />);
  expect(screen.getByText("new")).toBeInTheDocument();
  rerender(<Shell page="chat-a" />);
  expect(screen.getByText("Title chat-a:380:42")).toBeInTheDocument();
  rerender(<Shell page="chat-a" account="b" />);
  expect(screen.getByText("new")).toBeInTheDocument();
});
