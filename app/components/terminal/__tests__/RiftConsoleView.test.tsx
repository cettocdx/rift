import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ConsoleSnapshot } from "@/packages/console/src/protocol";
import { RiftConsoleView } from "../RiftConsoleView";

jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

function snapshot(overrides: Partial<ConsoleSnapshot> = {}): ConsoleSnapshot {
  return {
    chatId: "chat-12345678",
    status: "ready",
    entries: [],
    model: "first",
    modelLabel: "First model",
    effort: "high",
    approval: "ask",
    mode: "build",
    target: "local",
    targetLabel: "This Mac",
    models: [
      { value: "first", label: "First model", description: "General coding" },
      { value: "second", label: "Second model", description: "Complex tasks" },
    ],
    efforts: [
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    permissions: [{ value: "ask", label: "Review first" }],
    modes: [{ value: "build", label: "Build" }],
    targets: [{ value: "local", label: "This Mac" }],
    approvals: [],
    queued: 0,
    ...overrides,
  };
}

const input = () =>
  screen.getByRole("combobox", { name: "Message RIFT console" });
const command = () => jest.fn().mockResolvedValue({ accepted: true });

describe("RIFT console", () => {
  it("does not force a layout to size an empty composer on opening", () => {
    const height = jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(80);
    try {
      render(<RiftConsoleView snapshot={snapshot()} onCommand={command()} />);
      expect(height).not.toHaveBeenCalled();
      expect(input()).toHaveStyle({ height: "20px" });
      fireEvent.change(input(), { target: { value: "A multiline\ndraft" } });
      expect(height).toHaveBeenCalled();
      expect(input()).toHaveStyle({ height: "80px" });
    } finally {
      height.mockRestore();
    }
  });
  it("starts an empty console at the welcome header, then follows actual output", () => {
    const height = jest
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(1000);
    try {
      const onCommand = command();
      const { rerender } = render(
        <RiftConsoleView snapshot={snapshot()} onCommand={onCommand} />,
      );
      const viewport = screen.getByLabelText("Console transcript");
      expect(viewport.scrollTop).toBe(0);
      rerender(
        <RiftConsoleView
          snapshot={snapshot({
            entries: [{ id: "first-output", kind: "assistant", text: "Hello" }],
          })}
          onCommand={onCommand}
        />,
      );
      expect(viewport.scrollTop).toBe(1000);
      rerender(
        <RiftConsoleView
          snapshot={snapshot({ chatId: "new-empty" })}
          onCommand={onCommand}
        />,
      );
      expect(viewport.scrollTop).toBe(0);
    } finally {
      height.mockRestore();
    }
  });

  it("shows the RIFT welcome and only the supplied target context", () => {
    render(
      <RiftConsoleView
        snapshot={snapshot({ chatId: null })}
        onCommand={command()}
      />,
    );
    expect(
      screen.getByText("Recursive Intelligence for Technology"),
    ).toBeInTheDocument();
    expect(screen.getByText("This Mac")).toBeInTheDocument();
    expect(
      screen.queryByText(/\/home\/user|500K|Grok Build/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New chat /new" }),
    ).toBeInTheDocument();
  });

  it("submits to the active chat once and retains text typed while awaiting acceptance", async () => {
    let resolve!: (result: { accepted: boolean }) => void;
    const onCommand = jest.fn(
      () =>
        new Promise<{ accepted: boolean }>((done) => {
          resolve = done;
        }),
    );
    render(<RiftConsoleView snapshot={snapshot()} onCommand={onCommand} />);
    fireEvent.change(input(), { target: { value: "Explain the workspace" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({
      type: "submit",
      text: "Explain the workspace",
      chatId: "chat-12345678",
    });
    fireEvent.change(input(), { target: { value: "Follow-up draft" } });
    await act(async () => resolve({ accepted: true }));
    expect(input()).toHaveValue("Follow-up draft");
  });

  it("preserves a rejected message and displays the actual command error", async () => {
    const onCommand = jest.fn().mockResolvedValue({
      accepted: false,
      error: "Choose a workspace first.",
    });
    render(<RiftConsoleView snapshot={snapshot()} onCommand={onCommand} />);
    fireEvent.change(input(), { target: { value: "Run the tests" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a workspace first.",
    );
    expect(input()).toHaveValue("Run the tests");
  });

  it("navigates model choices from the slash palette without sending the command as a prompt", async () => {
    const onCommand = command();
    render(<RiftConsoleView snapshot={snapshot()} onCommand={onCommand} />);
    fireEvent.change(input(), { target: { value: "/model " } });
    expect(screen.getByRole("listbox", { name: "Model" })).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith({
        type: "set-model",
        value: "second",
      }),
    );
    await waitFor(() => expect(input()).toHaveValue(""));
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it("changes settings through the caption while preserving an unrelated draft", async () => {
    const onCommand = command();
    render(<RiftConsoleView snapshot={snapshot()} onCommand={onCommand} />);
    fireEvent.change(input(), { target: { value: "A draft to keep" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Select effort: High" }),
    );
    expect(screen.getByRole("option", { name: /High/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith({
        type: "set-effort",
        value: "medium",
      }),
    );
    expect(input()).toHaveValue("A draft to keep");
  });

  it("opens a setting on its current value and starts filtered results at the first match", async () => {
    const onCommand = command();
    render(
      <RiftConsoleView
        snapshot={snapshot({ model: "second", modelLabel: "Second model" })}
        onCommand={onCommand}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Select model: Second model" }),
    );
    expect(
      screen.getByRole("option", { name: /Second model/ }),
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith({
        type: "set-model",
        value: "second",
      }),
    );
    fireEvent.change(input(), { target: { value: "/model First" } });
    expect(screen.getByRole("option", { name: /First model/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("closes a palette when the reader returns to the transcript without sending anything", () => {
    const onCommand = command();
    render(<RiftConsoleView snapshot={snapshot()} onCommand={onCommand} />);
    fireEvent.change(input(), { target: { value: "/effort " } });
    fireEvent.pointerDown(screen.getByLabelText("Console transcript"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input()).toHaveValue("/effort ");
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("preserves an unrelated draft when help is opened from the commands control", () => {
    render(<RiftConsoleView snapshot={snapshot()} onCommand={command()} />);
    fireEvent.change(input(), { target: { value: "Keep this instruction" } });
    fireEvent.click(screen.getByRole("button", { name: "/ commands" }));
    fireEvent.click(screen.getByRole("option", { name: /\/help/ }));
    expect(input()).toHaveValue("Keep this instruction");
    expect(
      screen.getByRole("listbox", { name: "Commands" }),
    ).toBeInTheDocument();
  });

  it("clears a matching slash draft selected from the model caption", async () => {
    render(<RiftConsoleView snapshot={snapshot()} onCommand={command()} />);
    fireEvent.change(input(), { target: { value: "/model " } });
    fireEvent.click(
      screen.getByRole("button", { name: "Select model: First model" }),
    );
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(input()).toHaveValue(""));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps technical chat identifiers out of the visible session heading", () => {
    render(<RiftConsoleView snapshot={snapshot()} onCommand={command()} />);
    expect(screen.getByText("Build")).toHaveAttribute("title", "chat-12345678");
    expect(
      screen.queryByText(/chat-12345678|chat chat-123/),
    ).not.toBeInTheDocument();
  });

  it("dismisses an open menu on Escape before stopping an active run", async () => {
    const onCommand = command();
    render(
      <RiftConsoleView
        snapshot={snapshot({ status: "streaming" })}
        onCommand={onCommand}
      />,
    );
    fireEvent.change(input(), { target: { value: "/model " } });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onCommand).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith({
        type: "stop",
        chatId: "chat-12345678",
      }),
    );
  });

  it("leaves Shift Enter and composition Enter available for text editing", () => {
    const onCommand = command();
    render(<RiftConsoleView snapshot={snapshot()} onCommand={onCommand} />);
    fireEvent.change(input(), { target: { value: "Write a multiline plan" } });
    expect(fireEvent.keyDown(input(), { key: "Enter", shiftKey: true })).toBe(
      true,
    );
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("queues follow-ups through the same submit contract while streaming", async () => {
    const onCommand = command();
    render(
      <RiftConsoleView
        snapshot={snapshot({ status: "streaming", queued: 2 })}
        onCommand={onCommand}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("2 queued");
    fireEvent.change(input(), { target: { value: "Also check the tests" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith({
        type: "submit",
        text: "Also check the tests",
        chatId: "chat-12345678",
      }),
    );
  });

  it("restores the unsent draft after navigating accepted prompt history", async () => {
    render(<RiftConsoleView snapshot={snapshot()} onCommand={command()} />);
    fireEvent.change(input(), { target: { value: "First instruction" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(input()).toHaveValue(""));
    fireEvent.change(input(), { target: { value: "Unsent instruction" } });
    (input() as HTMLTextAreaElement).setSelectionRange(0, 0);
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input()).toHaveValue("First instruction");
    (input() as HTMLTextAreaElement).setSelectionRange(17, 17);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveValue("Unsent instruction");
  });

  it("sends approval decisions with the actual request and chat IDs", async () => {
    const onCommand = command();
    render(
      <RiftConsoleView
        snapshot={snapshot({
          approvals: [
            { id: "approval-7", toolName: "Run command", preview: "pnpm test" },
          ],
        })}
        onCommand={onCommand}
      />,
    );
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith({
        type: "approve",
        id: "approval-7",
        approve: false,
        chatId: "chat-12345678",
      }),
    );
  });

  it("disables unavailable submission and offers the supplied Open Build action", () => {
    const onCommand = command();
    const onOpenApp = jest.fn();
    render(
      <RiftConsoleView
        snapshot={snapshot({ status: "unavailable" })}
        onCommand={onCommand}
        onOpenApp={onOpenApp}
      />,
    );
    expect(input()).toBeDisabled();
    expect(
      screen.getByText("Open Build to connect this console."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Build" }));
    expect(onOpenApp).toHaveBeenCalledTimes(1);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("does not pull the reader down during streaming until they return to latest", () => {
    const entries: ConsoleSnapshot["entries"] = [
      { id: "a", kind: "assistant", text: "Start of the answer" },
    ];
    const onCommand = command();
    const { rerender } = render(
      <RiftConsoleView
        snapshot={snapshot({ entries })}
        onCommand={onCommand}
      />,
    );
    const viewport = screen.getByLabelText("Console transcript");
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);
    rerender(
      <RiftConsoleView
        snapshot={snapshot({
          entries: [
            {
              ...entries[0],
              text: "Start of the answer and more streamed output",
            },
          ],
        })}
        onCommand={onCommand}
      />,
    );
    expect(viewport.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    expect(viewport.scrollTop).toBe(1000);
    expect(
      screen.queryByRole("button", { name: "Latest" }),
    ).not.toBeInTheDocument();
  });

  it("folds only supplied activity details and hides the welcome after the first entry", () => {
    const entries: ConsoleSnapshot["entries"] = [
      { id: "a", kind: "activity", text: "Read two files\napp.ts\nstyles.css" },
      { id: "b", kind: "activity", text: "Thought for 2s" },
    ];
    render(
      <RiftConsoleView
        snapshot={snapshot({ entries })}
        onCommand={command()}
      />,
    );
    expect(
      screen.queryByText("Recursive Intelligence for Technology"),
    ).not.toBeInTheDocument();
    const details = screen.getByText("Read two files").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Thought for 2s").closest("details")).toBeNull();
  });
});

it("shows the shared orb only while the console is actively working", () => {
  const onCommand = command();
  const { container, rerender } = render(
    <RiftConsoleView
      snapshot={snapshot({ status: "streaming" })}
      onCommand={onCommand}
    />,
  );
  expect(
    container.querySelector('[data-ui="cursor-activity-glyph"]'),
  ).toBeInTheDocument();
  rerender(
    <RiftConsoleView
      snapshot={snapshot({
        status: "streaming",
        approvals: [
          { id: "approval", toolName: "Edit file", preview: "Write app.ts" },
        ],
      })}
      onCommand={onCommand}
    />,
  );
  expect(
    container.querySelector('[data-ui="cursor-activity-glyph"]'),
  ).not.toBeInTheDocument();
  rerender(<RiftConsoleView snapshot={snapshot()} onCommand={onCommand} />);
  expect(
    container.querySelector('[data-ui="cursor-activity-glyph"]'),
  ).not.toBeInTheDocument();
});
