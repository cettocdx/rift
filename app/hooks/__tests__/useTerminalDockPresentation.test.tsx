import { useEffect, useLayoutEffect } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  useTerminalDockPresentation,
  terminalDockPresentationKey,
} from "../useTerminalDockPresentation";

beforeEach(() => sessionStorage.clear());
const save = (
  account: string,
  pathname: string,
  open: boolean,
  view: "agent" | "terminal",
) =>
  sessionStorage.setItem(
    terminalDockPresentationKey(account),
    JSON.stringify({ version: 1, pathname, open, view }),
  );

it("restores the open terminal view after a same-route renderer remount", async () => {
  const first = renderHook(() =>
    useTerminalDockPresentation("account-a", "/c/one"),
  );
  act(() => {
    first.result.current.setOpen(true);
    first.result.current.setView("terminal");
  });
  first.unmount();
  const restored = renderHook(() =>
    useTerminalDockPresentation("account-a", "/c/one"),
  );
  await waitFor(() =>
    expect(restored.result.current).toMatchObject({
      open: true,
      view: "terminal",
    }),
  );
});

it("waits through auth hydration without overwriting the saved open view", async () => {
  save("account-a", "/c/one", true, "terminal");
  const before = sessionStorage.getItem(
    terminalDockPresentationKey("account-a"),
  );
  const hook = renderHook(
    ({ account }: { account: string | null | undefined }) =>
      useTerminalDockPresentation(account, "/c/one"),
    { initialProps: { account: undefined } },
  );
  expect(hook.result.current.open).toBe(false);
  expect(sessionStorage.getItem(terminalDockPresentationKey("account-a"))).toBe(
    before,
  );
  hook.rerender({ account: "account-a" });
  await waitFor(() =>
    expect(hook.result.current).toMatchObject({ open: true, view: "terminal" }),
  );
});

it("does not reuse another account presentation, and confirmed logout hides it", async () => {
  save("account-a", "/c/one", true, "terminal");
  const hook = renderHook(
    ({ account }: { account: string | null }) =>
      useTerminalDockPresentation(account, "/c/one"),
    { initialProps: { account: "account-a" } },
  );
  await waitFor(() => expect(hook.result.current.open).toBe(true));
  hook.rerender({ account: "account-b" });
  expect(hook.result.current).toMatchObject({ open: false, view: "agent" });
  act(() => hook.result.current.setOpen(true));
  hook.rerender({ account: null });
  expect(hook.result.current.open).toBe(false);
  expect(
    JSON.parse(
      sessionStorage.getItem(terminalDockPresentationKey("account-a"))!,
    ),
  ).toMatchObject({ open: true, view: "terminal" });
});

it("restores visibility only for the recorded route and persists an explicit hide", async () => {
  save("account-a", "/c/one", true, "terminal");
  const hook = renderHook(() =>
    useTerminalDockPresentation("account-a", "/c/two"),
  );
  expect(hook.result.current.open).toBe(false);
  act(() => hook.result.current.setOpen(true));
  act(() => hook.result.current.setOpen(false));
  hook.unmount();
  const restored = renderHook(() =>
    useTerminalDockPresentation("account-a", "/c/two"),
  );
  expect(restored.result.current.open).toBe(false);
  expect(restored.result.current.view).toBe("terminal");
});

it("ignores malformed saved data and remains usable without persistent storage", () => {
  sessionStorage.setItem(terminalDockPresentationKey("account-a"), "{invalid");
  const hook = renderHook(() =>
    useTerminalDockPresentation("account-a", "/c/one"),
  );
  expect(hook.result.current.open).toBe(false);
  const write = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("storage disabled");
    });
  try {
    act(() => hook.result.current.setOpen(true));
    expect(hook.result.current.open).toBe(true);
  } finally {
    write.mockRestore();
  }
});

it.each([
  ["/", "/settings/general"],
  ["/workspace/c/one", "/workspace/settings/appearance"],
  ["/lab/app/c/one", "/lab/app/settings"],
])(
  "suspends %s without overwriting its saved presentation at %s",
  (appPath, settingsPath) => {
    const hook = renderHook(
      ({ pathname }) => useTerminalDockPresentation("account-a", pathname),
      { initialProps: { pathname: appPath } },
    );
    act(() => {
      hook.result.current.setOpen(true);
      hook.result.current.setView("terminal");
    });
    hook.rerender({ pathname: settingsPath });
    expect(hook.result.current.open).toBe(false);
    expect(
      JSON.parse(
        sessionStorage.getItem(terminalDockPresentationKey("account-a"))!,
      ),
    ).toMatchObject({ pathname: appPath, open: true, view: "terminal" });
    hook.rerender({ pathname: appPath });
    expect(hook.result.current).toMatchObject({ open: true, view: "terminal" });
  },
);

it("retains direct new-chat promotion but closes on a different existing chat", () => {
  const hook = renderHook(
    ({ pathname }) => useTerminalDockPresentation("account-a", pathname),
    { initialProps: { pathname: "/" } },
  );
  act(() => hook.result.current.setOpen(true));
  hook.rerender({ pathname: "/c/new-chat" });
  expect(hook.result.current.open).toBe(true);
  hook.rerender({ pathname: "/c/another-chat" });
  expect(hook.result.current.open).toBe(false);
});

it("does not treat leaving Settings for another chat as new-chat promotion", () => {
  const hook = renderHook(
    ({ pathname }) => useTerminalDockPresentation("account-a", pathname),
    { initialProps: { pathname: "/" } },
  );
  act(() => hook.result.current.setOpen(true));
  hook.rerender({ pathname: "/settings/general" });
  hook.rerender({ pathname: "/c/other-chat" });
  expect(hook.result.current.open).toBe(false);
});

it("does not open a closed suspended dock through a shortcut in Settings", () => {
  const hook = renderHook(
    ({ pathname }) => useTerminalDockPresentation("account-a", pathname),
    { initialProps: { pathname: "/c/one" } },
  );
  hook.rerender({ pathname: "/settings/general" });
  act(() => hook.result.current.toggle());
  hook.rerender({ pathname: "/c/one" });
  expect(hook.result.current.open).toBe(false);
});

it("keeps every committed promotion render open without remounting visible terminal content", () => {
  const commits: boolean[] = [];
  const mount = jest.fn();
  const unmount = jest.fn();
  function TerminalContent() {
    useEffect(() => {
      mount();
      return () => {
        unmount();
      };
    }, []);
    return <div>Terminal content</div>;
  }
  function Probe({ pathname }: { pathname: string }) {
    const dock = useTerminalDockPresentation("account-a", pathname);
    useLayoutEffect(() => {
      commits.push(dock.open);
    });
    return (
      <>
        <button onClick={() => dock.setOpen(true)}>Open</button>
        {dock.open && <TerminalContent />}
      </>
    );
  }
  const app = render(<Probe pathname="/" />);
  fireEvent.click(screen.getByText("Open"));
  commits.length = 0;
  app.rerender(<Probe pathname="/c/new-chat" />);
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every(Boolean)).toBe(true);
  expect(mount).toHaveBeenCalledTimes(1);
  expect(unmount).not.toHaveBeenCalled();
});

it.each(["settings", "account", "closed"])(
  "never commits an open promotion frame after %s",
  (transition) => {
    const commits: boolean[] = [];
    const hook = renderHook(
      ({ account, pathname }) => {
        const dock = useTerminalDockPresentation(account, pathname);
        useLayoutEffect(() => {
          commits.push(dock.open);
        });
        return dock;
      },
      { initialProps: { account: "account-a", pathname: "/" } },
    );
    if (transition !== "closed") act(() => hook.result.current.setOpen(true));
    if (transition === "settings")
      hook.rerender({ account: "account-a", pathname: "/settings/general" });
    commits.length = 0;
    hook.rerender({
      account: transition === "account" ? "account-b" : "account-a",
      pathname: "/c/another-chat",
    });
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((open) => !open)).toBe(true);
  },
);
