import { Suspense, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HackSessionEntry } from "../HackSessionEntry";
const mockReplace = jest.fn();
const mockPush = jest.fn();
const router = { replace: mockReplace, push: mockPush };
jest.mock("next/navigation", () => ({ useRouter: () => router }));
jest.mock("@/app/components/HackerMode", () => ({
  HackerMode: ({
    chatId,
    accountId,
    onNewAssessment,
    onPreviousAssessment,
  }: {
    chatId: string;
    accountId: string;
    onNewAssessment: () => void;
    onPreviousAssessment?: () => void;
  }) => (
    <div data-testid="session" data-account={accountId}>
      <span>{chatId}</span>
      <button onClick={onNewAssessment}>New assessment</button>
      {onPreviousAssessment && (
        <button onClick={onPreviousAssessment}>Previous assessment</button>
      )}
    </div>
  ),
}));
const ID = "123e4567-e89b-42d3-a456-426614174000";
beforeEach(() => {
  sessionStorage.clear();
  mockReplace.mockClear();
  mockPush.mockReset();
});

it("prevents editing the previous assessment while the next route is still loading", async () => {
  let releaseRoute!: () => void;
  let routeReady = false;
  const pendingRoute = new Promise<void>((resolve) => {
    releaseRoute = () => {
      routeReady = true;
      resolve();
    };
  });
  function RoutedWorkbench() {
    const [selected, setSelected] = useState(ID);
    mockPush.mockImplementation((destination: string) => {
      setSelected(
        new URL(destination, "https://example.test").searchParams.get(
          "session",
        )!,
      );
    });
    if (selected !== ID && !routeReady) throw pendingRoute;
    return (
      <HackSessionEntry
        accountId="delayed-navigation"
        requestedSession={selected}
      />
    );
  }
  render(
    <Suspense fallback={<span>Loading route</span>}>
      <RoutedWorkbench />
    </Suspense>,
  );
  fireEvent.click(screen.getByRole("button", { name: "New assessment" }));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("session").closest("[inert]")).not.toBeNull();
  expect(
    screen.getByRole("status", { name: "Opening assessment" }),
  ).toBeVisible();
  await act(async () => {
    releaseRoute();
    await pendingRoute;
  });
  const nextSession = new URL(
    mockPush.mock.calls[0][0],
    "https://example.test",
  ).searchParams.get("session")!;
  expect(screen.getByTestId("session")).toHaveTextContent(nextSession);
  expect(screen.getByTestId("session").closest("[inert]")).toBeNull();
  expect(
    screen.queryByRole("status", { name: "Opening assessment" }),
  ).not.toBeInTheDocument();
});
it("reopening the sidebar destination restores the same account's session", () => {
  const first = render(
    <HackSessionEntry accountId="one" requestedSession={ID} />,
  );
  first.unmount();
  render(<HackSessionEntry accountId="one" />);
  expect(screen.getByTestId("session")).toHaveTextContent(ID);
  expect(mockReplace).toHaveBeenCalledWith(`/hack?session=${ID}`);
});
it("another account never inherits the previous account's session", () => {
  sessionStorage.setItem("rift:hack-session:one", ID);
  render(<HackSessionEntry accountId="two" />);
  expect(screen.getByTestId("session")).not.toHaveTextContent(ID);
});
it("an explicit session URL wins over a previous selection", () => {
  sessionStorage.setItem(
    "rift:hack-session:one",
    "223e4567-e89b-42d3-a456-426614174000",
  );
  render(<HackSessionEntry accountId="one" requestedSession={ID} />);
  expect(screen.getByTestId("session")).toHaveTextContent(ID);
  expect(sessionStorage.getItem("rift:hack-session:one")).toBe(ID);
  expect(mockReplace).not.toHaveBeenCalled();
});

it("opens a fresh account-bound assessment with push and keeps the previous route returnable", () => {
  const view = render(
    <HackSessionEntry accountId="fresh-assessment" requestedSession={ID} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "New assessment" }));
  expect(mockPush).toHaveBeenCalledTimes(1);
  const destination = mockPush.mock.calls[0][0];
  const fresh = new URL(destination, "https://example.test").searchParams.get(
    "session",
  );
  expect(fresh).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(fresh).not.toBe(ID);
  expect(mockReplace).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("rift:hack-session:fresh-assessment")).toBe(ID);
  view.rerender(
    <HackSessionEntry accountId="fresh-assessment" requestedSession={fresh!} />,
  );
  expect(screen.getByTestId("session")).toHaveAttribute(
    "data-account",
    "fresh-assessment",
  );
  expect(screen.getByTestId("session")).toHaveTextContent(fresh!);
  view.rerender(
    <HackSessionEntry accountId="fresh-assessment" requestedSession={ID} />,
  );
  expect(screen.getByTestId("session")).toHaveTextContent(ID);
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it("preserves the account session across remounts when browser storage is disabled", () => {
  const get = jest
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });
  const set = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });
  try {
    const first = render(
      <HackSessionEntry accountId="storage-disabled" requestedSession={ID} />,
    );
    first.unmount();
    const second = render(<HackSessionEntry accountId="storage-disabled" />);
    expect(screen.getByTestId("session")).toHaveTextContent(ID);
    expect(mockReplace).toHaveBeenLastCalledWith(`/hack?session=${ID}`);
    second.rerender(<HackSessionEntry accountId="another-storage-disabled" />);
    expect(screen.getByTestId("session")).not.toHaveTextContent(ID);
  } finally {
    get.mockRestore();
    set.mockRestore();
  }
});

it("remembers the previous committed assessment for this account and navigates back without creating another session", () => {
  const first = render(
    <HackSessionEntry accountId="previous-account" requestedSession={ID} />,
  );
  expect(
    screen.queryByRole("button", { name: "Previous assessment" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "New assessment" }));
  const freshRoute = mockPush.mock.calls[0][0];
  const freshId = new URL(freshRoute, "https://example.test").searchParams.get(
    "session",
  )!;
  expect(
    screen.queryByRole("button", { name: "Previous assessment" }),
  ).not.toBeInTheDocument();
  first.unmount();
  const fresh = render(
    <HackSessionEntry
      accountId="previous-account"
      requestedSession={freshId}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous assessment" }));
  expect(mockPush).toHaveBeenLastCalledWith(`/hack?session=${ID}`);
  expect(mockPush).toHaveBeenCalledTimes(2);
  fresh.rerender(
    <HackSessionEntry accountId="previous-account" requestedSession={ID} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous assessment" }));
  expect(mockPush).toHaveBeenLastCalledWith(freshRoute);
  fresh.rerender(
    <HackSessionEntry
      accountId="isolated-previous-account"
      requestedSession={ID}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Previous assessment" }),
  ).not.toBeInTheDocument();
});
