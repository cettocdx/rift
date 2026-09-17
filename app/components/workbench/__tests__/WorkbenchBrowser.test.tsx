import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchBrowser } from "../WorkbenchBrowser";

const mockInvoke = jest.fn();
const mockDesktop = jest.fn(() => true);
const mockOpenExternal = jest.fn(async (_url: string) => false);
jest.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
jest.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ scaleFactor: async () => 2 }),
}));
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => mockDesktop(),
  openInBrowser: (url: string) => mockOpenExternal(url),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const state = (tabId: string, url = "https://one.example/", title = "One") => ({
  tabId,
  url,
  title,
  loading: false,
  canGoBack: false,
  canGoForward: false,
});
let resize: () => void;
let rect = { x: 10, y: 20, width: 500, height: 300 };
let hidden = false;
const settle = async () => {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
};

beforeEach(() => {
  mockDesktop.mockReturnValue(true);
  mockInvoke
    .mockReset()
    .mockImplementation(async (command, args) =>
      command === "browser_tab_create" || command === "browser_tab_navigate"
        ? state(args.tabId, args.url)
        : command === "browser_tab_snapshot" || command === "browser_tab_action"
          ? state(args.tabId)
          : null,
    );
  mockOpenExternal.mockReset().mockResolvedValue(false);
  hidden = false;
  rect = { x: 10, y: 20, width: 500, height: 300 };
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 2,
  });
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(() => ({
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    }));
  global.ResizeObserver = class {
    constructor(callback: () => void) {
      resize = callback;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(async () => {
  document
    .querySelectorAll('[role="dialog"]')
    .forEach((element) => element.remove());
  delete document.body.dataset.riftDockResizing;
  await settle();
  jest.restoreAllMocks();
});

it("queues an initial URL change behind native creation instead of losing it", async () => {
  const create = deferred<ReturnType<typeof state>>();
  let observedUrl = "https://one.example/";
  mockInvoke.mockImplementation((command, args) => {
    if (command === "browser_tab_create") return create.promise;
    if (command === "browser_tab_navigate") observedUrl = args.url;
    return Promise.resolve(
      state(
        args?.tabId,
        observedUrl,
        observedUrl.includes("two") ? "Two" : "One",
      ),
    );
  });
  const { rerender, unmount } = render(
    <WorkbenchBrowser active initialUrl="https://one.example" />,
  );
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith(
      "browser_tab_create",
      expect.anything(),
    ),
  );
  const tabId = mockInvoke.mock.calls[0][1].tabId;
  rerender(<WorkbenchBrowser active initialUrl="https://two.example" />);
  expect(screen.queryByText(/not ready/)).not.toBeInTheDocument();
  expect(
    mockInvoke.mock.calls.filter(([name]) => name === "browser_tab_navigate"),
  ).toHaveLength(0);
  await act(async () => {
    create.resolve(state(tabId));
  });
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("browser_tab_navigate", {
      tabId,
      url: "https://two.example/",
    }),
  );
  expect(screen.getByRole("textbox", { name: "Browser address" })).toHaveValue(
    "https://two.example/",
  );
  unmount();
});

it("discards a stale poll after a newer navigation and serializes mutations", async () => {
  const poll = deferred<ReturnType<typeof state>>();
  let tabId = "";
  mockInvoke.mockImplementation((command, args) => {
    if (command === "browser_tab_create") {
      tabId = args.tabId;
      return Promise.resolve(state(tabId));
    }
    if (command === "browser_tab_snapshot") return poll.promise;
    return Promise.resolve(
      command === "browser_tab_navigate" ? state(tabId, args.url, "Two") : null,
    );
  });
  const onTitleChange = jest.fn();
  const { rerender, unmount } = render(
    <WorkbenchBrowser
      active
      initialUrl="https://one.example"
      onTitleChange={onTitleChange}
    />,
  );
  await waitFor(() =>
    expect(
      mockInvoke.mock.calls.some(([name]) => name === "browser_tab_snapshot"),
    ).toBe(true),
  );
  onTitleChange.mockClear();
  rerender(
    <WorkbenchBrowser
      active
      initialUrl="https://two.example"
      onTitleChange={onTitleChange}
    />,
  );
  await act(async () => {
    poll.resolve(state(tabId, "https://one.example/", "Stale One"));
  });
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("browser_tab_navigate", {
      tabId,
      url: "https://two.example/",
    }),
  );
  expect(onTitleChange).not.toHaveBeenCalledWith("Stale One");
  expect(screen.getByRole("textbox", { name: "Browser address" })).toHaveValue(
    "https://two.example/",
  );
  unmount();
});

it("hides above-DOM native content for overlays, resizing and hidden documents, then restores it", async () => {
  const { unmount } = render(
    <WorkbenchBrowser active initialUrl="https://one.example" />,
  );
  await waitFor(() =>
    expect(
      mockInvoke.mock.calls.some(
        ([name, args]) => name === "browser_tab_layout" && args.visible,
      ),
    ).toBe(true),
  );
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  await act(async () => {
    document.body.appendChild(overlay);
  });
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("browser_tabs_hide_all", {}),
  );
  mockInvoke.mockClear();
  await act(async () => {
    overlay.remove();
  });
  await waitFor(() =>
    expect(
      mockInvoke.mock.calls.some(
        ([name, args]) => name === "browser_tab_layout" && args.visible,
      ),
    ).toBe(true),
  );
  mockInvoke.mockClear();
  await act(async () => {
    document.body.dataset.riftDockResizing = "true";
  });
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("browser_tabs_hide_all", {}),
  );
  mockInvoke.mockClear();
  await act(async () => {
    delete document.body.dataset.riftDockResizing;
  });
  await waitFor(() =>
    expect(
      mockInvoke.mock.calls.some(
        ([name, args]) => name === "browser_tab_layout" && args.visible,
      ),
    ).toBe(true),
  );
  mockInvoke.mockClear();
  await act(async () => {
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("browser_tabs_hide_all", {}),
  );
  mockInvoke.mockClear();
  await act(async () => {
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    resize();
  });
  await waitFor(() =>
    expect(
      mockInvoke.mock.calls.some(
        ([name, args]) => name === "browser_tab_layout" && args.visible,
      ),
    ).toBe(true),
  );
  unmount();
});

it("hides and closes an obsolete generation without applying late state", async () => {
  const create = deferred<ReturnType<typeof state>>();
  mockInvoke.mockImplementation((command) =>
    command === "browser_tab_create" ? create.promise : Promise.resolve(null),
  );
  const title = jest.fn();
  const { unmount } = render(
    <WorkbenchBrowser
      active
      initialUrl="https://one.example"
      onTitleChange={title}
    />,
  );
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith(
      "browser_tab_create",
      expect.anything(),
    ),
  );
  const tabId = mockInvoke.mock.calls[0][1].tabId;
  unmount();
  await act(async () => {
    create.resolve(state(tabId, "https://one.example", "Late"));
  });
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("browser_tab_close", { tabId }),
  );
  expect(mockInvoke).toHaveBeenCalledWith("browser_tabs_hide_all", {});
  expect(title).not.toHaveBeenCalled();
  expect(
    mockInvoke.mock.calls.some(
      ([command, args]) => command === "browser_tab_layout" && args.visible,
    ),
  ).toBe(false);
});

it("hides a native view after its successful show loses the acknowledgement", async () => {
  const showResponse = deferred<void>();
  let nativeVisible = false;
  const originalInvoke = mockInvoke.getMockImplementation()!;
  mockInvoke.mockImplementation(async (command, args) => {
    if (command === "browser_tab_layout" && args.visible) {
      nativeVisible = true;
      await showResponse.promise;
      throw new Error("Native show succeeded but its response was lost");
    }
    if (command === "browser_tabs_hide_all") nativeVisible = false;
    return originalInvoke(command, args);
  });
  const { unmount } = render(
    <WorkbenchBrowser active initialUrl="https://one.example" />,
  );
  try {
    await waitFor(() => expect(nativeVisible).toBe(true));
    await act(async () => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      showResponse.resolve();
    });
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("browser_tabs_hide_all", {}),
    );
    expect(nativeVisible).toBe(false);
    expect(
      mockInvoke.mock.calls.filter(
        ([command, args]) => command === "browser_tab_layout" && args.visible,
      ),
    ).toHaveLength(1);
  } finally {
    showResponse.resolve();
    unmount();
  }
});

it.each(["inactive", "hidden document"])(
  "retries an unacknowledged native hide while %s without reopening or changing focus",
  async (reason) => {
    let nativeVisible = false;
    let hideAttempts = 0;
    const originalInvoke = mockInvoke.getMockImplementation()!;
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "browser_tab_layout" && args.visible) {
        nativeVisible = true;
      } else if (
        (command === "browser_tab_layout" && !args.visible) ||
        command === "browser_tabs_hide_all"
      ) {
        hideAttempts++;
        if (hideAttempts === 1)
          throw new Error("Native hide was not acknowledged");
        nativeVisible = false;
      }
      return originalInvoke(command, args);
    });
    const { rerender, unmount } = render(
      <WorkbenchBrowser active initialUrl="https://one.example" />,
    );
    const activity = document.createElement("button");
    activity.textContent = "Activity";
    document.body.append(activity);
    try {
      await waitFor(() => expect(nativeVisible).toBe(true));
      activity.focus();
      if (reason === "inactive") {
        rerender(
          <WorkbenchBrowser active={false} initialUrl="https://one.example" />,
        );
      } else {
        hidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
      }
      await waitFor(() => expect(hideAttempts).toBe(1));
      expect(nativeVisible).toBe(true);
      await act(async () => {
        for (let index = 0; index < 20; index++) resize();
        await new Promise((done) => setTimeout(done, 150));
      });
      expect(hideAttempts).toBe(1);
      await waitFor(() => expect(nativeVisible).toBe(false), { timeout: 1800 });
      expect(hideAttempts).toBe(2);
      expect(activity).toHaveFocus();
      await act(async () => {
        await new Promise((done) => setTimeout(done, 250));
      });
      expect(hideAttempts).toBe(2);
      expect(
        mockInvoke.mock.calls.filter(
          ([command, args]) => command === "browser_tab_layout" && args.visible,
        ),
      ).toHaveLength(1);
    } finally {
      unmount();
      activity.remove();
    }
  },
);

it("preserves the verified preview origin for module scripts but isolates navigation elsewhere", async () => {
  mockDesktop.mockReturnValue(false);
  const { rerender } = render(
    <WorkbenchBrowser
      active
      initialUrl="https://preview.example/app"
      verifiedPreviewUrl="https://preview.example/app"
    />,
  );
  expect(
    screen.getByTitle("Web page preview").getAttribute("sandbox"),
  ).toContain("allow-same-origin");
  rerender(
    <WorkbenchBrowser
      active
      initialUrl="https://other.example"
      verifiedPreviewUrl="https://preview.example/app"
    />,
  );
  await waitFor(() =>
    expect(screen.getByTitle("Web page preview")).toHaveAttribute(
      "src",
      "https://other.example/",
    ),
  );
  expect(
    screen.getByTitle("Web page preview").getAttribute("sandbox"),
  ).not.toContain("allow-same-origin");
});

it("never grants preview origin access to RIFT's own origin", () => {
  mockDesktop.mockReturnValue(false);
  render(
    <WorkbenchBrowser
      active
      initialUrl={window.location.origin}
      verifiedPreviewUrl={window.location.origin}
    />,
  );
  expect(
    screen.getByTitle("Web page preview").getAttribute("sandbox"),
  ).not.toContain("allow-same-origin");
});

it("uses an isolated web preview on unsupported desktops and opens external fallback", async () => {
  mockInvoke.mockRejectedValue(
    "Native browser tabs are not available on this platform yet.",
  );
  const open = jest.spyOn(window, "open").mockReturnValue(null);
  render(<WorkbenchBrowser active initialUrl="localhost:3020" />);
  const frame = await screen.findByTitle("Web page preview");
  expect(frame).toHaveAttribute("src", "http://localhost:3020/");
  expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  fireEvent.click(screen.getByRole("button", { name: "Open page externally" }));
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      "http://localhost:3020/",
      "_blank",
      "noopener,noreferrer",
    ),
  );
});

it("serializes rapid navigation and ignores the first request's late response", async () => {
  const first = deferred<ReturnType<typeof state>>();
  let requested = "https://one.example/";
  mockInvoke.mockImplementation((command, args) => {
    if (command === "browser_tab_navigate") {
      requested = args.url;
      if (args.url.includes("two")) return first.promise;
    }
    return Promise.resolve(state(args?.tabId, requested));
  });
  const { rerender, unmount } = render(
    <WorkbenchBrowser active initialUrl="https://one.example" />,
  );
  await waitFor(() =>
    expect(
      mockInvoke.mock.calls.some(([name]) => name === "browser_tab_snapshot"),
    ).toBe(true),
  );
  rerender(<WorkbenchBrowser active initialUrl="https://two.example" />);
  await waitFor(() =>
    expect(
      mockInvoke.mock.calls.some(([name]) => name === "browser_tab_navigate"),
    ).toBe(true),
  );
  const tabId = mockInvoke.mock.calls.find(
    ([name]) => name === "browser_tab_create",
  )![1].tabId;
  rerender(<WorkbenchBrowser active initialUrl="https://three.example" />);
  await settle();
  expect(
    mockInvoke.mock.calls.filter(([name]) => name === "browser_tab_navigate"),
  ).toHaveLength(1);
  await act(async () => {
    first.resolve(state(tabId, "https://two.example/", "Outdated"));
  });
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("browser_tab_navigate", {
      tabId,
      url: "https://three.example/",
    }),
  );
  expect(screen.getByRole("textbox", { name: "Browser address" })).toHaveValue(
    "https://three.example/",
  );
  unmount();
});

it("hides an inactive tab, stops polling it, and converts CSS zoom to native bounds", async () => {
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 3,
  });
  const { rerender, unmount } = render(
    <WorkbenchBrowser active initialUrl="https://one.example" />,
  );
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith(
      "browser_tab_layout",
      expect.objectContaining({
        visible: true,
        bounds: { x: 15, y: 30, width: 750, height: 450 },
      }),
    ),
  );
  mockInvoke.mockClear();
  rerender(
    <WorkbenchBrowser active={false} initialUrl="https://one.example" />,
  );
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith(
      "browser_tab_layout",
      expect.objectContaining({ visible: false }),
    ),
  );
  mockInvoke.mockClear();
  await act(async () => {
    await new Promise((done) => setTimeout(done, 550));
  });
  expect(
    mockInvoke.mock.calls.some(([name]) => name === "browser_tab_snapshot"),
  ).toBe(false);
  unmount();
});

it("opens the web fallback synchronously without a desktop bridge or parent-origin access", () => {
  mockDesktop.mockReturnValue(false);
  const open = jest.spyOn(window, "open").mockReturnValue(null);
  render(<WorkbenchBrowser active initialUrl="https://example.com" />);
  fireEvent.click(screen.getByRole("button", { name: "Open page externally" }));
  expect(open).toHaveBeenCalledWith(
    "https://example.com/",
    "_blank",
    "noopener,noreferrer",
  );
  expect(mockOpenExternal).not.toHaveBeenCalled();
  expect(
    screen.getByTitle("Web page preview").getAttribute("sandbox"),
  ).not.toContain("allow-same-origin");
});

it("preserves a queued navigation when Reload is pressed before creation finishes", async () => {
  const create = deferred<ReturnType<typeof state>>();
  mockInvoke.mockImplementation((command, args) =>
    command === "browser_tab_create"
      ? create.promise
      : Promise.resolve(state(args?.tabId, "https://two.example/")),
  );
  const { rerender, unmount } = render(
    <WorkbenchBrowser active initialUrl="https://one.example" />,
  );
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith(
      "browser_tab_create",
      expect.anything(),
    ),
  );
  const tabId = mockInvoke.mock.calls[0][1].tabId;
  rerender(<WorkbenchBrowser active initialUrl="https://two.example" />);
  fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
  await act(async () => {
    create.resolve(state(tabId));
  });
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("browser_tab_action", {
      tabId,
      action: "reload",
    }),
  );
  const actions = mockInvoke.mock.calls.filter(
    ([name]) =>
      name === "browser_tab_navigate" || name === "browser_tab_action",
  );
  expect(actions.map(([name]) => name)).toEqual([
    "browser_tab_navigate",
    "browser_tab_action",
  ]);
  expect(actions[0][1].url).toBe("https://two.example/");
  unmount();
});

it("keeps a focused address editable after Enter for repeated navigation", async () => {
  mockDesktop.mockReturnValue(false);
  const user = userEvent.setup();
  render(<WorkbenchBrowser active />);
  const address = screen.getByRole("textbox", { name: "Browser address" });
  await user.type(address, "one.example{Enter}");
  expect(address).toHaveFocus();
  expect(address).toHaveValue("https://one.example/");
  expect(screen.getByTitle("Web page preview")).toHaveAttribute(
    "src",
    "https://one.example/",
  );

  await user.clear(address);
  expect(address).toHaveValue("");
  await user.keyboard("two.example/path");
  expect(address).toHaveValue("two.example/path");
  await user.keyboard("{Enter}");
  expect(address).toHaveFocus();
  expect(address).toHaveValue("https://two.example/path");
  expect(screen.getByTitle("Web page preview")).toHaveAttribute(
    "src",
    "https://two.example/path",
  );
});

it("keeps an invalid address available for correction without navigating", async () => {
  mockDesktop.mockReturnValue(false);
  const user = userEvent.setup();
  render(<WorkbenchBrowser active initialUrl="https://one.example" />);
  const address = screen.getByRole("textbox", { name: "Browser address" });
  await user.clear(address);
  await user.keyboard("javascript:alert(1){Enter}");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter a valid http or https address.",
  );
  expect(address).toHaveFocus();
  expect(address).toHaveValue("javascript:alert(1)");
  expect(screen.getByTitle("Web page preview")).toHaveAttribute(
    "src",
    "https://one.example/",
  );

  await user.clear(address);
  await user.keyboard("localhost:3020{Enter}");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(address).toHaveValue("http://localhost:3020/");
  expect(screen.getByTitle("Web page preview")).toHaveAttribute(
    "src",
    "http://localhost:3020/",
  );
});

it("does not measure hidden native tabs on every unrelated transcript mutation", async () => {
  const { rerender, unmount } = render(
    <WorkbenchBrowser active initialUrl="https://one.example" />,
  );
  await settle();
  rerender(
    <WorkbenchBrowser active={false} initialUrl="https://one.example" />,
  );
  await settle();
  const measure = jest.mocked(HTMLElement.prototype.getBoundingClientRect);
  measure.mockClear();
  const transcript = document.createElement("div");
  document.body.append(transcript);
  for (let i = 0; i < 20; i++) {
    transcript.textContent = `Streaming token ${i}`;
    await settle();
  }
  expect(measure).not.toHaveBeenCalled();
  transcript.remove();
  unmount();
});

it("shares the dock header without recreating its native browser and keeps preview options reachable", async () => {
  const user = userEvent.setup();
  const host = document.createElement("header");
  document.body.append(host);
  const options = <button type="button">Mobile preview</button>;
  const { rerender, unmount, container } = render(
    <WorkbenchBrowser
      active
      initialUrl="https://one.example"
      toolbar={options}
    />,
  );
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith(
      "browser_tab_create",
      expect.anything(),
    ),
  );
  const nativeHost = container.querySelector("[data-native-browser-host]");
  rerender(
    <WorkbenchBrowser
      active
      initialUrl="https://one.example"
      toolbar={options}
      toolbarTarget={host}
    />,
  );
  expect(
    host.querySelector('input[aria-label="Browser address"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('input[aria-label="Browser address"]'),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Preview options" }));
  expect(
    screen.getByRole("button", { name: "Open page externally" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Mobile preview" })).toBeVisible();
  await user.keyboard("{Escape}");
  rerender(
    <WorkbenchBrowser
      active
      initialUrl="https://one.example"
      toolbar={options}
    />,
  );
  expect(container.querySelector("[data-native-browser-host]")).toBe(
    nativeHost,
  );
  expect(
    mockInvoke.mock.calls.filter(([name]) => name === "browser_tab_create"),
  ).toHaveLength(1);
  expect(host.querySelector("form")).toBeNull();
  unmount();
  host.remove();
});

it("does not remeasure a visible browser for sibling transcript updates or scrolling", async () => {
  // Isolate event-driven layout work from the periodic position safety check.
  jest.spyOn(window, "setInterval").mockImplementation(() => 0);
  const { unmount } = render(
    <WorkbenchBrowser active initialUrl="https://one.example" />,
  );
  await settle();
  await settle();
  const transcript = document.createElement("section");
  document.body.append(transcript);
  await settle();
  const measure = jest.mocked(HTMLElement.prototype.getBoundingClientRect);
  measure.mockClear();
  for (let i = 0; i < 20; i++) {
    transcript.textContent = `Streaming token ${i}`;
    transcript.className = `stream-${i}`;
    transcript.dispatchEvent(new Event("scroll"));
    await settle();
  }
  expect(measure).not.toHaveBeenCalled();

  // An overlay inside a newly inserted wrapper must still hide native content
  // immediately, without relying on the disabled periodic safety check.
  const wrapper = document.createElement("div");
  wrapper.innerHTML = '<div role="dialog">Approve action</div>';
  mockInvoke.mockClear();
  await act(async () => {
    document.body.append(wrapper);
  });
  await settle();
  expect(mockInvoke).toHaveBeenCalledWith("browser_tabs_hide_all", {});
  mockInvoke.mockClear();
  await act(async () => {
    wrapper.remove();
  });
  await settle();
  expect(
    mockInvoke.mock.calls.some(
      ([name, args]) => name === "browser_tab_layout" && args.visible,
    ),
  ).toBe(true);
  transcript.remove();
  unmount();
});

it("does not republish an unchanged native title on every snapshot poll", async () => {
  const onTitleChange = jest.fn();
  const { unmount } = render(
    <WorkbenchBrowser
      active
      initialUrl="https://one.example"
      onTitleChange={onTitleChange}
    />,
  );
  await waitFor(() => expect(onTitleChange).toHaveBeenCalledWith("One"));
  await act(async () => {
    await new Promise((done) => setTimeout(done, 1100));
  });
  expect(
    mockInvoke.mock.calls.filter(([name]) => name === "browser_tab_snapshot")
      .length,
  ).toBeGreaterThanOrEqual(2);
  expect(onTitleChange).toHaveBeenCalledTimes(1);
  unmount();
});

it.each([false, true])(
  "reports explicit reload in desktop=%s without replacing browser navigation",
  async (desktop) => {
    mockDesktop.mockReturnValue(desktop);
    const onReload = jest.fn();
    const view = render(
      <WorkbenchBrowser
        active
        initialUrl="https://one.example/"
        onReload={onReload}
      />,
    );
    await settle();
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    if (desktop) {
      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith(
          "browser_tab_action",
          expect.objectContaining({ action: "reload" }),
        ),
      );
    } else {
      expect(screen.getByTitle("Web page preview")).toHaveAttribute(
        "src",
        "https://one.example/",
      );
    }
    view.unmount();
  },
);
