import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BuildPreviewPanel } from "../BuildPreviewPanel";
let mockUrl = "https://saved.example";
jest.mock("../../contexts/GlobalState", () => ({
  useGlobalState: () => ({
    buildPreviewUrl: mockUrl,
    setBuildPreviewOpen: jest.fn(),
  }),
}));
jest.mock("../workbench/WorkbenchBrowser", () => ({
  WorkbenchBrowser: ({
    initialUrl,
    onReload,
  }: {
    initialUrl: string;
    onReload?: () => void;
  }) => (
    <div>
      <button onClick={onReload}>Reload page</button>
      <iframe title="Verified browser" src={initialUrl} />
    </div>
  ),
}));
jest.mock("../PreviewIdleGrid", () => ({
  PreviewIdleGrid: () => <div>Building</div>,
}));
const response = (status: string, chatId = "chat-a", previewUrl = mockUrl) => ({
  ok: true,
  json: async () => ({
    status,
    chatId,
    previewUrl,
    ...(status === "running" ? { url: previewUrl } : {}),
  }),
});
beforeEach(() => {
  mockUrl = "https://saved.example";
  global.fetch = jest.fn();
});
it("does not open a saved preview until verified and offers explicit retry for stopped previews", async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce(response("stopped"))
    .mockResolvedValueOnce(response("running"));
  render(<BuildPreviewPanel chatId="chat-a" embedded />);
  expect(screen.queryByTitle("Verified browser")).not.toBeInTheDocument();
  expect(await screen.findByText("Preview stopped")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect(await screen.findByTitle("Verified browser")).toHaveAttribute(
    "src",
    mockUrl,
  );
});
it("fences a late result when the chat changes or the panel becomes hidden", async () => {
  let resolve!: (value: unknown) => void;
  (fetch as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue(response("missing", "chat-b"));
  const view = render(<BuildPreviewPanel chatId="chat-a" embedded />);
  view.rerender(<BuildPreviewPanel chatId="chat-b" embedded />);
  expect(await screen.findByText("Preview unavailable")).toBeInTheDocument();
  await act(async () => resolve(response("running", "chat-a")));
  expect(screen.queryByTitle("Verified browser")).not.toBeInTheDocument();
  view.rerender(<BuildPreviewPanel chatId="chat-b" embedded active={false} />);
  expect((fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not check hidden or invalid previews", () => {
  const view = render(
    <BuildPreviewPanel chatId="chat-a" embedded active={false} />,
  );
  view.rerender(<BuildPreviewPanel embedded />);
  mockUrl = "javascript:alert(1)";
  view.rerender(<BuildPreviewPanel chatId="chat-a" embedded />);
  expect(fetch).not.toHaveBeenCalled();
});
it("times out a hung health check and ignores its late success", async () => {
  jest.useFakeTimers();
  let resolve!: (value: unknown) => void;
  (fetch as jest.Mock).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<BuildPreviewPanel chatId="chat-a" />);
  await act(async () => {
    jest.advanceTimersByTime(15_000);
  });
  expect(screen.getByText("Couldn’t check preview")).toBeInTheDocument();
  await act(async () => resolve(response("running")));
  expect(screen.queryByTitle("App preview")).not.toBeInTheDocument();
  jest.useRealTimers();
});

it("rechecks after hiding a running preview and after its saved URL changes", async () => {
  (fetch as jest.Mock).mockResolvedValue(response("running"));
  const view = render(<BuildPreviewPanel chatId="chat-a" embedded />);
  const browser = await screen.findByTitle("Verified browser");
  view.rerender(<BuildPreviewPanel chatId="chat-a" embedded active={false} />);
  expect(screen.getByTitle("Verified browser")).toBe(browser);
  (fetch as jest.Mock).mockResolvedValue(response("paused"));
  view.rerender(<BuildPreviewPanel chatId="chat-a" embedded />);
  expect(screen.getByTitle("Verified browser")).toBe(browser);
  expect(await screen.findByText("Preview paused")).toBeInTheDocument();
  mockUrl = "https://replacement.example";
  (fetch as jest.Mock).mockResolvedValue(response("running"));
  view.rerender(<BuildPreviewPanel chatId="chat-a" embedded />);
  expect(screen.queryByTitle("Verified browser")).not.toBeInTheDocument();
  expect(await screen.findByTitle("Verified browser")).toHaveAttribute(
    "src",
    mockUrl,
  );
  expect(fetch).toHaveBeenCalledTimes(3);
});
it.each([
  ["running", "other-chat", "https://saved.example", "Preview unavailable"],
  ["running", "chat-a", "https://other.example", "Preview unavailable"],
  [
    "stale",
    "chat-a",
    "https://new-persisted.example",
    "Saved preview has changed",
  ],
  ["unavailable", "chat-a", "https://saved.example", "Preview unavailable"],
  ["transient", "chat-a", "https://saved.example", "Couldn’t check preview"],
])(
  "handles %s without mounting an unverified iframe",
  async (status, chatId, url, title) => {
    (fetch as jest.Mock).mockResolvedValue(response(status, chatId, url));
    render(<BuildPreviewPanel chatId="chat-a" />);
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByTitle("App preview")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as jest.Mock).mock.calls[0][0]).toContain(
      "/api/preview/status?",
    );
  },
);
it("treats a failed status endpoint as a retryable check failure", async () => {
  (fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });
  render(<BuildPreviewPanel chatId="chat-a" embedded />);
  expect(await screen.findByText("Couldn’t check preview")).toBeInTheDocument();
  expect(screen.queryByTitle("Verified browser")).not.toBeInTheDocument();
});

it("preserves unsupported local previews with a neutral label", async () => {
  mockUrl = "http://localhost:5173";
  (fetch as jest.Mock).mockResolvedValue(response("unsupported"));
  render(<BuildPreviewPanel chatId="chat-a" embedded />);
  expect(await screen.findByTitle("Verified browser")).toHaveAttribute(
    "src",
    mockUrl,
  );
  expect(screen.getByText("Preview")).toBeInTheDocument();
  expect(screen.queryByText("Preview running")).not.toBeInTheDocument();
});

it("resumes only after a click and verifies the same saved preview before showing it", async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce(response("paused"))
    .mockResolvedValueOnce(response("running"));
  render(<BuildPreviewPanel chatId="chat-a" embedded />);
  const resume = await screen.findByRole("button", { name: "Resume preview" });
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(resume);
  expect(await screen.findByTitle("Verified browser")).toBeInTheDocument();
  expect((fetch as jest.Mock).mock.calls[1]).toEqual([
    "/api/preview/resume",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ chatId: "chat-a", previewUrl: mockUrl }),
    }),
  ]);
});
it("does not transfer a resume request to another chat and ignores its late response", async () => {
  let finish!: (value: unknown) => void;
  (fetch as jest.Mock)
    .mockResolvedValueOnce(response("paused"))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    )
    .mockResolvedValueOnce(response("paused", "chat-b"));
  const view = render(<BuildPreviewPanel chatId="chat-a" embedded />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Resume preview" }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  view.rerender(<BuildPreviewPanel chatId="chat-b" embedded />);
  await screen.findByText("Preview paused");
  expect((fetch as jest.Mock).mock.calls[2][0]).toContain(
    "/api/preview/status?",
  );
  await act(async () => finish(response("running")));
  expect(screen.queryByTitle("Verified browser")).not.toBeInTheDocument();
});

it("keeps the verified browser mounted through successful tab revalidation", async () => {
  let finish!: (value: unknown) => void;
  (fetch as jest.Mock)
    .mockResolvedValueOnce(response("running"))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
  const view = render(<BuildPreviewPanel chatId="chat-a" embedded />);
  const browser = await screen.findByTitle("Verified browser");
  view.rerender(<BuildPreviewPanel chatId="chat-a" embedded active={false} />);
  expect(screen.getByTitle("Verified browser")).toBe(browser);
  view.rerender(<BuildPreviewPanel chatId="chat-a" embedded />);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByTitle("Verified browser")).toBe(browser);
  await act(async () => finish(response("running")));
  expect(screen.getByTitle("Verified browser")).toBe(browser);
});

it.each(["network", "server", "timeout"])(
  "retains the verified preview through %s revalidation failure and retry",
  async (failure) => {
    (fetch as jest.Mock).mockResolvedValueOnce(response("running"));
    const view = render(<BuildPreviewPanel chatId="chat-a" embedded />);
    const browser = await screen.findByTitle("Verified browser");
    view.rerender(
      <BuildPreviewPanel chatId="chat-a" embedded active={false} />,
    );
    if (failure === "timeout") {
      jest.useFakeTimers();
      (fetch as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
    } else if (failure === "server") {
      (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 });
    } else {
      (fetch as jest.Mock).mockRejectedValueOnce(
        new TypeError("Failed to fetch"),
      );
    }
    view.rerender(<BuildPreviewPanel chatId="chat-a" embedded />);
    try {
      if (failure === "timeout")
        await act(async () => {
          jest.advanceTimersByTime(12_001);
        });
      await screen.findByText(
        "Couldn’t recheck preview. Keeping your open preview.",
      );
      expect(screen.getByTitle("Verified browser")).toBe(browser);
      expect(screen.queryByText("Preview running")).not.toBeInTheDocument();
      let finish!: (value: unknown) => void;
      (fetch as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((r) => {
            finish = r;
          }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      expect(screen.getByTitle("Verified browser")).toBe(browser);
      await act(async () => finish(response("running")));
      expect(screen.getByTitle("Verified browser")).toBe(browser);
      expect(
        screen.queryByText(
          "Couldn’t recheck preview. Keeping your open preview.",
        ),
      ).not.toBeInTheDocument();
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  },
);

it("removes the retained preview when revalidation denies access", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response("running"));
  const view = render(<BuildPreviewPanel chatId="chat-a" embedded />);
  await screen.findByTitle("Verified browser");
  view.rerender(<BuildPreviewPanel chatId="chat-a" embedded active={false} />);
  (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 403 });
  view.rerender(<BuildPreviewPanel chatId="chat-a" embedded />);
  await screen.findByText("Preview unavailable");
  expect(screen.queryByTitle("Verified browser")).not.toBeInTheDocument();
});

// A sandbox can pause while its preview tab stays open. Reload must refresh
// the authoritative state, not leave the old running badge forever.
it("embedded reload detects a paused environment without replaying the task", async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce(response("running"))
    .mockResolvedValueOnce(response("paused"));
  render(<BuildPreviewPanel chatId="chat-a" embedded />);
  await screen.findByTitle("Verified browser");
  fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
  expect(await screen.findByText("Preview paused")).toBeInTheDocument();
  expect(screen.queryByTitle("Verified browser")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, init] of (fetch as jest.Mock).mock.calls) {
    expect(url).toContain("/api/preview/status?");
    expect(init.method).toBeUndefined();
  }
});
