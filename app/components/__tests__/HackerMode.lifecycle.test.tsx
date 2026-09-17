import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { HackDispatchState } from "@/lib/chat/hack-dispatch-state";
import { HackerMode } from "../HackerMode";
import { convertToUIMessages } from "@/lib/utils";
import { getHackAssessmentDraft } from "@/lib/hack/assessment-drafts";
import type { FileUploadStore } from "@/app/hooks/useFileUpload";

// JSDOM has no layout observer; live geometry is covered by browser fixtures.
const savedResizeObserver = global.ResizeObserver;
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  global.ResizeObserver = savedResizeObserver;
});

const mockSend = jest.fn();
const mockStop = jest.fn();
const mockCancelRun = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockAutoResume = jest.fn();
const mockCancel = jest.fn(() => Promise.resolve());
const mockPurpose = jest.fn();
let mockChat: any;
let mockRetainedOptions: any;
let mockChatData: any;
const history: { results: any[]; status: string } = {
  results: [],
  status: "Exhausted",
};
jest.mock("convex/react", () => ({
  useQuery: (query: unknown) =>
    require("convex/server").getFunctionName(query) ===
    "chats:getChatByIdFromClient"
      ? mockChatData
      : null,
  usePaginatedQuery: () => history,
  useMutation: () => mockCancel,
}));
jest.mock("@/app/hooks/useRetainedChat", () => ({
  useRetainedChat: (options: unknown) => {
    mockRetainedOptions = options;
    return mockChat;
  },
}));
jest.mock("@/app/hooks/useAutoResume", () => ({
  useAutoResume: (options: unknown) => {
    mockAutoResume(options);
    return false;
  },
}));
jest.mock("@/lib/chat/hack-transport", () => ({
  cancelHackRun: (...args: unknown[]) => mockCancelRun(...args),
  fetchHackChatStream: jest.fn(),
}));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    selectedModel: "test",
    sandboxPreference: "cloud",
    setChatPurpose: mockPurpose,
    uploadedFiles: [],
    clearUploadedFiles: jest.fn(),
  }),
}));
jest.mock("@/app/hooks/useFileUpload", () => ({
  useFileUpload: (
    _mode: string,
    options: { store: FileUploadStore; sandboxPreference: string },
  ) => {
    const store = options.store;
    const files = require("react").useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    );
    return {
      fileInputRef: { current: null },
      uploadedFiles: files,
      clearUploadedFiles: store.clear,
      getUploadedFileMessageParts: () =>
        files
          .filter((file: any) => file.uploaded)
          .map((file: any) => ({
            type: "file",
            fileId: file.fileId,
            name: file.file.name,
          })),
      anyFilesUploading: () => files.some((file: any) => file.uploading),
      handleRemoveFile: (index: number) =>
        store.remove(store.idOf(files[index])!),
    };
  },
}));
jest.mock("../MemoizedMarkdown", () => ({
  MemoizedMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));
jest.mock("../ToolApprovalRequests", () => ({
  ToolApprovalRequests: () => null,
}));

beforeEach(() => {
  mockCancelRun.mockReset().mockResolvedValue(undefined);
  history.results = [];
  mockChatData = null;
  mockChat = {
    messages: [],
    status: "ready",
    sendMessage: mockSend,
    stop: mockStop,
    setMessages: jest.fn(),
    resumeStream: jest.fn(),
  };
});
const originalConsoleError = console.error;
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation((error, ...args) => {
    // jsdom cannot parse the workbench's CSS nesting; this suite tests behavior.
    if (String(error).includes("Could not parse CSS stylesheet")) return;
    originalConsoleError(error, ...args);
  });
});
afterEach(() => jest.restoreAllMocks());

it("keeps the workbench inside Safari's visible keyboard viewport without losing its draft", () => {
  const previousViewport = Object.getOwnPropertyDescriptor(
    window,
    "visualViewport",
  );
  const previousHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
  const previousClientHeight = Object.getOwnPropertyDescriptor(
    document.documentElement,
    "clientHeight",
  );
  const viewport = Object.assign(new EventTarget(), {
    height: 377,
    offsetTop: 337,
    scale: 1,
  });
  const media = Object.assign(new EventTarget(), { matches: true });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 377,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: 714,
  });
  jest
    .spyOn(window, "matchMedia")
    .mockReturnValue(media as unknown as MediaQueryList);
  const mounted = render(<HackerMode chatId="mobile-keyboard" />);
  try {
    const root = mounted.container.querySelector(
      "[data-rift-workspace]",
    )! as HTMLElement;
    changeCommand("Keep this assessment draft");
    expect(root).toHaveClass("rift-chat-viewport");
    expect(root).toHaveAttribute("data-rift-visible-viewport");
    expect(root.style.getPropertyValue("--rift-chat-viewport-height")).toBe(
      "377px",
    );
    expect(root.style.getPropertyValue("--rift-chat-viewport-offset")).toBe(
      "337px",
    );
    expect(
      screen.getByRole("textbox", { name: "Security agent command" }),
    ).toHaveValue("Keep this assessment draft");
  } finally {
    mounted.unmount();
    for (const [object, key, descriptor] of [
      [window, "visualViewport", previousViewport],
      [window, "innerHeight", previousHeight],
      [document.documentElement, "clientHeight", previousClientHeight],
    ] as const) {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else Reflect.deleteProperty(object, key);
    }
  }
});
const changeScope = (value: string) =>
  fireEvent.change(screen.getByLabelText("Security assessment target"), {
    target: { value },
  });
const changeCommand = (value: string) =>
  fireEvent.change(screen.getByLabelText("Security agent command"), {
    target: { value },
  });
it("keeps an active assessment in reconnecting state instead of telling the user to resubmit", () => {
  mockChatData = {
    active_http_execution_id: "exec-a",
    active_stream_id: "exec-a",
  };
  mockChat = {
    ...mockChat,
    status: "error",
    error: new TypeError("network unavailable"),
  };
  render(<HackerMode accountId="owner" chatId="recovering-assessment" />);
  expect(
    screen.getByText("Reconnecting to your assessment…"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Assessment interrupted")).not.toBeInTheDocument();
  expect(screen.queryByText("Return to prompt")).not.toBeInTheDocument();
});
it("still reports a genuine failed assessment rather than hiding its error", () => {
  mockChat = {
    ...mockChat,
    status: "error",
    error: new Error("provider rejected this request"),
  };
  render(<HackerMode accountId="owner" chatId="failed-assessment" />);
  expect(screen.getByText("Assessment interrupted")).toBeInTheDocument();
  expect(
    screen.queryByText("Reconnecting to your assessment…"),
  ).not.toBeInTheDocument();
});
function prepare() {
  changeScope("old.example");
  fireEvent.click(screen.getByRole("button", { name: "Show task sidebar" }));
  fireEvent.click(
    screen.getByRole("button", { name: /Full target recon Map/ }),
  );
}
it("restores each account's assessment draft after visiting a fresh assessment without sending or stopping", () => {
  const accountId = "draft-round-trip";
  const navigateNew = jest.fn(),
    navigatePrevious = jest.fn();
  const first = render(
    <HackerMode
      accountId={accountId}
      chatId="draft-a"
      onNewAssessment={navigateNew}
    />,
  );
  prepare();
  changeCommand("Read only this supplied report");
  fireEvent.click(screen.getByRole("button", { name: "New assessment" }));
  expect(navigateNew).toHaveBeenCalledTimes(1);
  first.unmount();
  const fresh = render(
    <HackerMode
      accountId={accountId}
      chatId="draft-b"
      onPreviousAssessment={navigatePrevious}
    />,
  );
  expect(screen.getByLabelText("Security assessment target")).toHaveValue("");
  expect(screen.getByLabelText("Security agent command")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Run active operation" }),
  ).toBeDisabled();
  changeScope("second.example");
  changeCommand("Second assessment draft");
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Assessment history" }),
    { key: "Enter" },
  );
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Previous assessment" }),
  );
  expect(navigatePrevious).toHaveBeenCalledTimes(1);
  fresh.unmount();
  const restored = render(
    <HackerMode accountId={accountId} chatId="draft-a" />,
  );
  expect(screen.getByLabelText("Security assessment target")).toHaveValue(
    "old.example",
  );
  expect(screen.getByLabelText("Security agent command")).toHaveValue(
    "Read only this supplied report",
  );
  expect(
    screen.getByRole("button", { name: "Run active operation" }),
  ).toBeEnabled();
  restored.unmount();
  render(<HackerMode accountId="different-account" chatId="draft-a" />);
  expect(screen.getByLabelText("Security assessment target")).toHaveValue("");
  expect(screen.getByLabelText("Security agent command")).toHaveValue("");
  expect(mockSend).not.toHaveBeenCalled();
  expect(mockStop).not.toHaveBeenCalled();
  expect(mockCancelRun).not.toHaveBeenCalled();
});

it("keeps a late attachment upload in its originating assessment and sends only that assessment's files", () => {
  const accountId = "upload-round-trip";
  const firstStore = getHackAssessmentDraft(accountId, "files-a").uploads;
  const secondStore = getHackAssessmentDraft(accountId, "files-b").uploads;
  const first = render(<HackerMode accountId={accountId} chatId="files-a" />);
  let uploadId: string;
  act(() => {
    uploadId = firstStore.add({
      file: new File(["report"], "first-report.txt"),
      uploading: true,
      uploaded: false,
    });
  });
  expect(screen.getByText("first-report.txt")).toBeVisible();
  first.unmount();
  const fresh = render(<HackerMode accountId={accountId} chatId="files-b" />);
  act(() => {
    firstStore.update(uploadId!, {
      uploading: false,
      uploaded: true,
      fileId: "first-file",
    });
    secondStore.add({
      file: new File(["other"], "second-report.txt"),
      uploading: false,
      uploaded: true,
      fileId: "second-file",
    });
  });
  expect(screen.queryByText("first-report.txt")).not.toBeInTheDocument();
  expect(screen.getByText("second-report.txt")).toBeVisible();
  fresh.unmount();
  render(<HackerMode accountId={accountId} chatId="files-a" />);
  expect(screen.getByText("first-report.txt")).toBeVisible();
  expect(screen.queryByText("second-report.txt")).not.toBeInTheDocument();
  expect(mockSend).not.toHaveBeenCalled();
  expect(mockStop).not.toHaveBeenCalled();
  changeCommand("Read the attached report only");
  fireEvent.click(
    screen.getByRole("button", { name: "Send security request" }),
  );
  expect(mockSend).toHaveBeenCalledWith(
    {
      text: "Read the attached report only",
      files: [{ type: "file", fileId: "first-file", name: "first-report.txt" }],
    },
    expect.objectContaining({
      body: expect.objectContaining({
        purpose: "security",
        sandboxPreference: "e2b",
      }),
    }),
  );
  expect(firstStore.getSnapshot()).toEqual([]);
  expect(secondStore.getSnapshot()).toHaveLength(1);
});

it("keeps the original pending Stop while New assessment is open and never replays work on return", async () => {
  const state = new HackDispatchState();
  state.begin("original-execution", "http");
  mockChat.hackDispatch = state;
  mockChat.retentionEnabled = true;
  mockChat.status = "streaming";
  const originalChat = mockChat;
  let confirmStop!: () => void;
  mockCancelRun.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        confirmStop = resolve;
      }),
  );
  const onNewAssessment = jest.fn();
  const first = render(
    <HackerMode
      accountId="pending-round-trip"
      chatId="active-a"
      onNewAssessment={onNewAssessment}
    />,
  );
  changeScope("first.example");
  changeCommand("An unsent follow-up");
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  await waitFor(() => expect(mockCancelRun).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "New assessment" }));
  expect(onNewAssessment).toHaveBeenCalledTimes(1);
  first.unmount();
  mockChat = {
    ...originalChat,
    status: "ready",
    hackDispatch: new HackDispatchState(),
  };
  const fresh = render(
    <HackerMode accountId="pending-round-trip" chatId="fresh-b" />,
  );
  expect(screen.getByLabelText("Security agent command")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Send security request" }),
  ).toBeInTheDocument();
  expect(state.getSnapshot()).toEqual(
    expect.objectContaining({
      status: "stopping",
      stoppingDispatchId: "original-execution",
    }),
  );
  expect(mockCancelRun).toHaveBeenCalledTimes(1);
  fresh.unmount();
  mockChat = originalChat;
  render(<HackerMode accountId="pending-round-trip" chatId="active-a" />);
  expect(screen.getByLabelText("Security agent command")).toHaveValue(
    "An unsent follow-up",
  );
  expect(
    screen.getByRole("button", { name: "Stop active operation" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Send security request" }),
  ).not.toBeInTheDocument();
  expect(mockSend).not.toHaveBeenCalled();
  expect(mockChat.resumeStream).not.toHaveBeenCalled();
  expect(mockCancelRun).toHaveBeenCalledTimes(1);
  await act(async () => {
    confirmStop();
  });
  expect(state.getSnapshot().status).toBe("stopped");
});

it.each(["Send security request", "Run active operation"])(
  "uses the edited scope when submitting through %s",
  (name) => {
    render(<HackerMode chatId="session" />);
    prepare();
    changeScope("new.example");
    expect(
      (screen.getByLabelText("Security agent command") as HTMLInputElement)
        .value,
    ).toContain("new.example");
    fireEvent.click(screen.getByRole("button", { name }));
    expect(mockSend.mock.calls[0][0].text).toContain("new.example");
    expect(mockSend.mock.calls[0][0].text).not.toContain("old.example");
  },
);
it("does not replace explicit scope with a dotted filename in prose", () => {
  render(<HackerMode chatId="session" />);
  changeScope("selected.example");
  changeCommand("Inspect package.json and explain its dependencies");
  fireEvent.click(
    screen.getByRole("button", { name: "Send security request" }),
  );
  expect(screen.getByLabelText("Security assessment target")).toHaveValue(
    "selected.example",
  );
});
it("preserves an edited request when Run is used", () => {
  render(<HackerMode chatId="session" />);
  prepare();
  changeCommand("Only inspect the supplied report; do not scan");
  changeScope("new.example");
  fireEvent.click(screen.getByRole("button", { name: "Run active operation" }));
  expect(mockSend.mock.calls[0][0].text).toBe(
    "Only inspect the supplied report; do not scan",
  );
});
it("keeps a stopped answer partial after another request starts", async () => {
  mockChatData = { active_stream_id: "legacy-existing" };
  mockChat.messages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Check scope" }] },
    {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "Partial findings" }],
    },
  ];
  mockChat.status = "streaming";
  const view = render(<HackerMode chatId="session" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  mockChat = { ...mockChat, status: "ready" };
  view.rerender(<HackerMode chatId="session" />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send security request" }),
    ).toBeInTheDocument(),
  );
  changeCommand("Continue the assessment");
  fireEvent.click(
    screen.getByRole("button", { name: "Send security request" }),
  );
  mockChat = {
    ...mockChat,
    status: "streaming",
    messages: [
      ...mockChat.messages,
      { id: "u2", role: "user", parts: [{ type: "text", text: "Continue" }] },
    ],
  };
  view.rerender(<HackerMode chatId="session" />);
  expect(
    screen.getByRole("region", { name: "Partial response" }),
  ).toHaveTextContent("Partial findings");
  expect(
    screen.queryByRole("region", { name: "Final response" }),
  ).not.toBeInTheDocument();
});
it.each(["[REDACTED]", "[REDACTED]\n [REDACTED]"])(
  "hides unreadable reasoning %s",
  (text) => {
    mockChat.messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "reasoning", text, state: "streaming" }],
      },
    ];
    mockChat.status = "streaming";
    render(<HackerMode chatId="session" />);
    expect(
      screen.queryByRole("button", { name: /Work log/ }),
    ).not.toBeInTheDocument();
  },
);
it("does not label completed reasoning as an active thinking phase", () => {
  mockChat.messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Plan complete", state: "done" },
        { type: "data-agent-heartbeat" },
      ],
    },
  ];
  mockChat.status = "streaming";
  render(<HackerMode chatId="session" />);
  expect(
    screen.getByRole("button", { name: /Work log/ }),
  ).not.toHaveTextContent("Thinking");
  expect(screen.queryByText("Planning the next step…")).not.toBeInTheDocument();
});
it("keeps empty-session metrics hidden until conversation activity exists", () => {
  const view = render(<HackerMode chatId="session" />);
  expect(
    screen.queryByRole("region", { name: "Assessment overview" }),
  ).not.toBeInTheDocument();
  changeScope("selected.example");
  expect(
    screen.queryByRole("region", { name: "Assessment overview" }),
  ).not.toBeInTheDocument();
  mockChat = {
    ...mockChat,
    messages: [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Check the scope" }],
      },
    ],
  };
  view.rerender(<HackerMode chatId="session" />);
  expect(
    screen.getByRole("region", { name: "Assessment overview" }),
  ).toBeInTheDocument();
});

it("does not reactivate completed reasoning when the next reasoning is redacted", () => {
  mockChat.messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Plan complete", state: "done" },
        { type: "reasoning", text: "[REDACTED]", state: "streaming" },
      ],
    },
  ];
  mockChat.status = "streaming";
  render(<HackerMode chatId="session" />);
  expect(
    screen.getByRole("button", { name: /Work log/ }),
  ).not.toHaveTextContent("Thinking");
  expect(screen.queryByText("Planning the next step…")).not.toBeInTheDocument();
});

it.each([{ last_run_error: "Worker stopped" }, { canceled_at: 12345 }])(
  "keeps reloaded partial output partial with durable outcome %j",
  (outcome) => {
    mockChatData = outcome;
    mockChat.messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Partial findings" }],
      },
    ];
    render(<HackerMode chatId="session" />);
    expect(
      screen.getByRole("region", { name: "Partial response" }),
    ).toHaveTextContent("Partial findings");
    expect(
      screen.queryByRole("region", { name: "Final response" }),
    ).not.toBeInTheDocument();
  },
);
it("preserves a saved cancellation on an older response after reload", () => {
  mockChat.messages = [
    {
      id: "a1",
      role: "assistant",
      metadata: { stopReason: "user" },
      parts: [{ type: "text", text: "Partial findings" }],
    },
    { id: "u2", role: "user", parts: [{ type: "text", text: "Continue" }] },
    {
      id: "a2",
      role: "assistant",
      parts: [{ type: "text", text: "Completed findings" }],
    },
  ];
  render(<HackerMode chatId="session" />);
  expect(
    screen.getByRole("region", { name: "Partial response" }),
  ).toHaveTextContent("Partial findings");
  expect(
    screen.getByRole("region", { name: "Final response" }),
  ).toHaveTextContent("Completed findings");
});

const cutoffCases = [
  [
    "budget-exhausted",
    "The run stopped because its usage budget was exhausted.",
  ],
  [
    "context-limit",
    "The run stopped at its context limit before completing this response.",
  ],
  ["doom-loop", "The run stopped after repeating actions without progress."],
  [
    "preemptive-timeout",
    "The run stopped at its time limit before completing this response.",
  ],
  [
    "timeout",
    "The run stopped at its time limit before completing this response.",
  ],
  [
    "future-provider-cutoff",
    "The run ended without confirming a complete response.",
  ],
] as const;
const interimText =
  "The saved pages are available; I am now verifying the remaining evidence.";
const cutoffParts = [
  {
    type: "tool-run_terminal_cmd",
    toolCallId: "recorded-tool",
    state: "output-available",
    input: { command: "recorded action" },
    output: { exitCode: 0 },
  },
  { type: "text", text: interimText },
];

it.each(cutoffCases)(
  "presents a saved %s cutoff as partial output with its reason",
  (finishReason, reason) => {
    mockChatData = { finish_reason: finishReason };
    mockChat.messages = [
      { id: "cutoff", role: "assistant", parts: cutoffParts },
    ];
    // An older backend projection lacks the message outcome, but it must
    // still confirm this is the saved answer the chat-level outcome belongs to.
    history.results = [...mockChat.messages];
    render(<HackerMode chatId="session" />);
    const response = screen.getByRole("region", { name: "Partial response" });
    expect(response).toHaveTextContent(interimText);
    expect(response).toHaveTextContent(reason);
    expect(response.querySelector(".lucide-check")).toBeNull();
    expect(
      within(response).queryByRole("button", { name: "Open Evidence Report" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Final response" }),
    ).not.toBeInTheDocument();
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      `Partial assessment response. ${reason}`,
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Assessment response ready",
    );
  },
);

it.each(cutoffCases)(
  "preserves a persisted %s cutoff after a later completed turn and reload",
  (finishReason, reason) => {
    mockChatData = { finish_reason: "stop" };
    mockChat.messages = convertToUIMessages([
      {
        id: "cutoff",
        role: "assistant",
        parts: cutoffParts as any,
        finish_reason: finishReason,
      },
      {
        id: "next-user",
        role: "user",
        parts: [{ type: "text", text: "Explain the saved evidence" }],
      },
      {
        id: "complete",
        role: "assistant",
        parts: [{ type: "text", text: "Here is the completed explanation." }],
        finish_reason: "stop",
      },
    ]);
    render(<HackerMode chatId="session" />);
    expect(
      screen.getByRole("region", { name: "Partial response" }),
    ).toHaveTextContent(reason);
    expect(
      screen.getByRole("region", { name: "Final response" }),
    ).toHaveTextContent("Here is the completed explanation.");
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Assessment response ready$/,
    );
  },
);

it.each([{ active_stream_id: "stream" }, { active_trigger_run_id: "worker" }])(
  "does not apply a previous chat cutoff while its producer is active: %j",
  (active) => {
    mockChatData = { finish_reason: "preemptive-timeout", ...active };
    mockChat.messages = [
      { id: "current", role: "assistant", parts: cutoffParts },
    ];
    mockChat.status = "streaming";
    render(<HackerMode chatId="session" />);
    expect(
      screen.getByRole("region", { name: "Live update" }),
    ).toHaveTextContent(interimText);
    expect(
      screen.queryByRole("region", { name: "Partial response" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Partial assessment response",
    );
  },
);

it("uses a message's completed outcome instead of a stale chat cutoff", () => {
  mockChatData = { finish_reason: "doom-loop" };
  mockChat.messages = [
    {
      id: "older",
      role: "assistant",
      metadata: { finishReason: "stop" },
      parts: [{ type: "text", text: "Earlier completed answer" }],
    },
    { id: "u2", role: "user", parts: [{ type: "text", text: "Next request" }] },
    {
      id: "current",
      role: "assistant",
      metadata: { finishReason: "stop" },
      parts: [{ type: "text", text: "New completed answer" }],
    },
  ];
  render(<HackerMode chatId="session" />);
  expect(
    screen.getAllByRole("region", { name: "Final response" }),
  ).toHaveLength(2);
  expect(
    screen.queryByRole("region", { name: "Partial response" }),
  ).not.toBeInTheDocument();
});

it("does not apply stale chat outcome to a newer settled retained answer", () => {
  const older = {
    id: "older",
    role: "assistant",
    parts: [{ type: "text", text: "Earlier partial output" }],
  };
  const newer = {
    id: "newer",
    role: "assistant",
    parts: [{ type: "text", text: "The new request is complete." }],
  };
  mockChatData = { finish_reason: "timeout" };
  history.results = [{ ...older, finish_reason: "timeout" }];
  mockChat.messages = [
    older,
    {
      id: "new-user",
      role: "user",
      parts: [{ type: "text", text: "A different request" }],
    },
    newer,
  ];
  const view = render(<HackerMode chatId="session" />);
  expect(
    screen.getByRole("region", { name: "Partial response" }),
  ).toHaveTextContent("Earlier partial output");
  expect(
    screen.getByRole("region", { name: "Final response" }),
  ).toHaveTextContent("The new request is complete.");
  expect(screen.getByRole("status")).toHaveTextContent(
    /^Assessment response ready$/,
  );
  history.results = [
    { ...newer, finish_reason: "stop" },
    { ...older, finish_reason: "timeout" },
  ];
  mockChatData = { finish_reason: "stop" };
  view.rerender(<HackerMode chatId="session" />);
  expect(
    screen.getByRole("region", { name: "Final response" }),
  ).toHaveTextContent("The new request is complete.");
});

it("preserves the canonical tool-calls completion when a trailing response exists", () => {
  mockChat.messages = [
    {
      id: "complete",
      role: "assistant",
      metadata: { finishReason: "tool-calls" },
      parts: [
        cutoffParts[0],
        { type: "text", text: "The requested work is complete." },
      ],
    },
  ];
  render(<HackerMode chatId="session" />);
  expect(
    screen.getByRole("region", { name: "Final response" }),
  ).toHaveTextContent("The requested work is complete.");
});

it("does not manufacture a response for a tool-calls outcome ending at a tool", () => {
  mockChat.messages = [
    {
      id: "tool-end",
      role: "assistant",
      metadata: { finishReason: "tool-calls" },
      parts: [cutoffParts[1], cutoffParts[0]],
    },
  ];
  render(<HackerMode chatId="session" />);
  expect(
    screen.queryByRole("region", { name: "Final response" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "The run ended without a final response. The work log contains the available evidence.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Assessment ended without a final response.",
  );
});

it("announces a saved user interruption as partial without calling it ready", () => {
  mockChat.messages = [
    {
      id: "stopped",
      role: "assistant",
      metadata: { stopReason: "user" },
      parts: [{ type: "text", text: "Partial saved findings" }],
    },
  ];
  render(<HackerMode chatId="session" />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Partial assessment response. The run was interrupted.",
  );
});

it("supports multiline drafts without submitting Shift+Enter or composing input", () => {
  render(<HackerMode chatId="session" />);
  const input = screen.getByLabelText("Security agent command");
  expect(input.tagName).toBe("TEXTAREA");
  expect(
    screen.getByRole("button", { name: "Send security request" }),
  ).toBeDisabled();
  changeCommand("Explain this report\nwithout running tools");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(mockSend).not.toHaveBeenCalled();
  expect(input).toHaveValue("Explain this report\nwithout running tools");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend.mock.calls[0][0].text).toBe(
    "Explain this report\nwithout running tools",
  );
});

it("resizes an unchanged draft when available width changes", () => {
  const original = global.ResizeObserver;
  let frame: FrameRequestCallback | undefined;
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    frame = undefined;
  });
  const observers: {
    callback: ResizeObserverCallback;
    disconnect: jest.Mock;
  }[] = [];
  global.ResizeObserver = class {
    disconnect = jest.fn();
    observe = jest.fn();
    unobserve = jest.fn();
    constructor(callback: ResizeObserverCallback) {
      observers.push({ callback, disconnect: this.disconnect });
    }
  } as unknown as typeof ResizeObserver;
  try {
    const { unmount } = render(<HackerMode chatId="session" />);
    const input = screen.getByLabelText(
      "Security agent command",
    ) as HTMLTextAreaElement;
    let height = 24;
    Object.defineProperty(input, "scrollHeight", { get: () => height });
    changeCommand("Keep this draft while changing screen width");
    expect(input.style.height).toBe("24px");
    const resize = (width: number) => {
      observers.forEach(({ callback }) =>
        callback(
          [{ target: input, contentRect: { width } } as ResizeObserverEntry],
          {} as ResizeObserver,
        ),
      );
      const pending = frame;
      frame = undefined;
      pending?.(0);
    };
    resize(600);
    height = 96;
    resize(280);
    expect(input.style.height).toBe("96px");
    height = 24;
    resize(600);
    expect(input.style.height).toBe("24px");
    height = 300;
    resize(200);
    expect(input.style.height).toBe("144px");
    expect(input.value).toBe("Keep this draft while changing screen width");
    expect(mockSend).not.toHaveBeenCalled();
    unmount();
    expect(
      observers.every(({ disconnect }) => disconnect.mock.calls.length > 0),
    ).toBe(true);
  } finally {
    global.ResizeObserver = original;
  }
});

it("includes the selected scope in the explicit durable request", () => {
  render(<HackerMode chatId="session" durableEnabled />);
  changeScope("authorized.example");
  changeCommand("Review the supplied evidence");
  fireEvent.click(
    screen.getByRole("button", { name: "Send security request" }),
  );
  expect(mockSend.mock.calls[0][1].body).toMatchObject({
    scope: "authorized.example",
    purpose: "security",
  });
});
it("an active durable producer is eligible for observation after reload", () => {
  mockChatData = {
    active_trigger_run_id: "persisted-run",
    active_stream_id: null,
  };
  render(<HackerMode chatId="session" durableEnabled />);
  expect(mockAutoResume).toHaveBeenLastCalledWith(
    expect.objectContaining({ hasActiveStream: true }),
  );
});
it("shows a failed Stop acknowledgment and lets the operator retry", async () => {
  mockChatData = { active_trigger_run_id: "durable-existing" };
  mockCancelRun.mockRejectedValueOnce(new Error("not confirmed"));
  mockChat.status = "streaming";
  mockChat.messages = [{ id: "original-dispatch", role: "user", parts: [] }];
  const view = render(<HackerMode chatId="session" durableEnabled />);
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Stop not confirmed",
  );
  mockChat.status = "ready";
  mockChat.messages = [{ id: "newer-dispatch", role: "user", parts: [] }];
  view.rerender(<HackerMode chatId="session" durableEnabled />);
  fireEvent.click(screen.getByRole("button", { name: "Retry Stop" }));
  await waitFor(() =>
    expect(screen.queryByText("Stop not confirmed")).not.toBeInTheDocument(),
  );
  expect(mockCancelRun).toHaveBeenCalledTimes(2);
  expect(mockCancelRun).toHaveBeenCalledWith({
    chatId: "session",
    dispatchId: "original-dispatch",
    transport: "durable",
    durable: true,
    cancelLegacy: expect.any(Function),
  });
});

it("captures the initial request identity before admission or transcript updates", async () => {
  mockChat.status = "submitted";
  render(<HackerMode chatId="session" durableEnabled />);
  const request =
    await mockRetainedOptions.transport.prepareSendMessagesRequest({
      id: "session",
      messages: [{ id: "pre-admission", role: "user", parts: [] }],
      body: { scope: "offline" },
    });
  expect(request.body.messages[0].id).toBe("pre-admission");
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  await waitFor(() =>
    expect(mockCancelRun).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchId: "pre-admission" }),
    ),
  );
});
it("a delayed context response cannot replace the identity of a newer request", async () => {
  mockChat.status = "submitted";
  render(<HackerMode chatId="session" durableEnabled />);
  const transport = mockRetainedOptions.transport;
  const prepare = (id: string) =>
    transport.prepareSendMessagesRequest({
      id: "session",
      messages: [{ id, role: "user", parts: [] }],
      body: {},
    });
  await prepare("old");
  transport.fetch("/api/hack-long", { method: "POST" });
  const call =
    require("@/lib/chat/hack-transport").fetchHackChatStream.mock.calls.at(
      -1,
    )[0];
  await prepare("new");
  act(() =>
    call.onRequestContext({
      purpose: "security",
      dispatchId: "old",
      scope: "old.example",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  await waitFor(() =>
    expect(mockCancelRun).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchId: "new" }),
    ),
  );
});

it("restores unconfirmed Stop after route remount and retries the original request", async () => {
  const state = new HackDispatchState();
  state.begin("original");
  mockChat.hackDispatch = state;
  mockChat.status = "streaming";
  mockChat.messages = [{ id: "original", role: "user", parts: [] }];
  mockCancelRun.mockRejectedValueOnce(new Error("lost acknowledgment"));
  const view = render(<HackerMode chatId="session" durableEnabled />);
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Stop not confirmed",
  );
  view.unmount();
  mockChat.status = "ready";
  mockChat.messages = [{ id: "newer-history", role: "user", parts: [] }];
  render(<HackerMode chatId="session" durableEnabled />);
  expect(screen.getByRole("alert")).toHaveTextContent("Stop not confirmed");
  fireEvent.click(screen.getByRole("button", { name: "Retry Stop" }));
  await waitFor(() => expect(state.getSnapshot().status).toBe("stopped"));
  expect(mockCancelRun).toHaveBeenLastCalledWith(
    expect.objectContaining({ dispatchId: "original" }),
  );
});

it("a reloaded HTTP producer uses legacy Stop even after durable rollout is enabled", async () => {
  mockChatData = { active_stream_id: "legacy", active_trigger_run_id: null };
  mockChat.status = "streaming";
  render(<HackerMode chatId="session" durableEnabled />);
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  await waitFor(() =>
    expect(mockCancelRun).toHaveBeenCalledWith(
      expect.objectContaining({ durable: false }),
    ),
  );
});

it("pins a fresh HTTP execution before initial transport and changes it for regeneration", async () => {
  mockChat.status = "submitted";
  render(<HackerMode chatId="session" />);
  let prepared: any;
  await act(async () => {
    prepared = await mockRetainedOptions.transport.prepareSendMessagesRequest({
      id: "session",
      messages: [{ id: "same-user-message", role: "user", parts: [] }],
      body: {},
    });
  });
  expect(prepared.body.executionId).toEqual(expect.any(String));
  expect(prepared.body.executionId).not.toBe("same-user-message");
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  await waitFor(() =>
    expect(mockCancelRun).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: "http",
        durable: false,
        executionId: prepared.body.executionId,
      }),
    ),
  );
  let next: any;
  await act(async () => {
    next = await mockRetainedOptions.transport.prepareSendMessagesRequest({
      id: "session",
      messages: [{ id: "same-user-message", role: "user", parts: [] }],
      body: { regenerate: true },
    });
  });
  expect(next.body.executionId).not.toBe(prepared.body.executionId);
});

it("retains exact HTTP Stop identity and kind across unconfirmed remount", async () => {
  const state = new HackDispatchState();
  state.begin("http-original", "http");
  mockChat.hackDispatch = state;
  mockChat.status = "streaming";
  mockCancelRun.mockRejectedValueOnce(new Error("pending"));
  const view = render(<HackerMode chatId="session" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Stop not confirmed",
  );
  view.unmount();
  mockChat.status = "ready";
  mockChat.messages = [{ id: "newer", role: "user", parts: [] }];
  render(<HackerMode chatId="session" durableEnabled />);
  fireEvent.click(screen.getByRole("button", { name: "Retry Stop" }));
  await waitFor(() => expect(state.getSnapshot().status).toBe("stopped"));
  expect(mockCancelRun).toHaveBeenLastCalledWith(
    expect.objectContaining({
      transport: "http",
      durable: false,
      executionId: "http-original",
    }),
  );
});

it("uses authoritative exact HTTP metadata before reconnect headers arrive", async () => {
  mockChatData = {
    active_stream_id: "http-reload",
    active_http_execution_id: "http-reload",
  };
  mockChat.status = "streaming";
  render(<HackerMode chatId="session" durableEnabled />);
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  await waitFor(() =>
    expect(mockCancelRun).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: "http",
        executionId: "http-reload",
        durable: false,
      }),
    ),
  );
});
it("does not guess legacy cancellation while producer metadata is loading", async () => {
  mockChatData = undefined;
  mockChat.status = "streaming";
  const view = render(<HackerMode chatId="session" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Stop not confirmed",
  );
  expect(mockCancelRun).not.toHaveBeenCalled();
  mockChatData = {
    active_stream_id: "http-later",
    active_http_execution_id: "http-later",
  };
  view.rerender(<HackerMode chatId="session" />);
  fireEvent.click(screen.getByRole("button", { name: "Retry Stop" }));
  await waitFor(() =>
    expect(mockCancelRun).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: "http",
        executionId: "http-later",
      }),
    ),
  );
});

it("recognizes an HTTP assessment as active when returning before the stream marker", () => {
  mockChatData = { active_http_execution_id: "http-return" };
  mockChat.status = "ready";
  render(<HackerMode chatId="session" durableEnabled />);
  expect(mockAutoResume).toHaveBeenLastCalledWith(
    expect.objectContaining({ hasActiveStream: true }),
  );
});
