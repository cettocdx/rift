import { act, render, screen } from "@testing-library/react";
import { DesktopAccessStatusHandler } from "../DesktopAccessStatusHandler";

it("shows the actual unavailable reason instead of an invisible file failure", async () => {
  render(
    <DesktopAccessStatusHandler
      status="ready"
      part={{
        type: "tool-desktop_access_status",
        state: "output-available",
        output: {
          ok: false,
          code: "unavailable",
          error: "Desktop connection unavailable.",
        },
      }}
    />,
  );
  expect(
    screen.getByText("Desktop connection needs setup"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Desktop connection unavailable."),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: "Allow computer access" }),
  ).toBeInTheDocument();
});

it("preserves unexpected tool errors and does not invent a successful connection", () => {
  render(
    <DesktopAccessStatusHandler
      status="ready"
      part={{
        type: "tool-desktop_access_status",
        state: "output-error",
        errorText: "Invalid response",
      }}
    />,
  );
  expect(screen.getByText("Desktop connection failed")).toBeInTheDocument();
  expect(screen.getByText("Invalid response")).toBeInTheDocument();
  expect(screen.queryByText(/Cloud work can continue/)).not.toBeInTheDocument();
});

jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: jest.fn(() => true),
}));
jest.mock("@/app/services/desktop-local-access", () => ({
  getDesktopAccessStatus: jest.fn(),
  setDesktopAccess: jest.fn(),
  openDesktopPermissionSettings: jest.fn(),
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT: "rift:desktop-local-access-changed",
}));
jest.mock("@/lib/utils/submit-message", () => ({
  submitChatMessage: jest.fn(),
}));
import { fireEvent, waitFor } from "@testing-library/react";
import {
  getDesktopAccessStatus,
  setDesktopAccess,
} from "@/app/services/desktop-local-access";
import { submitChatMessage } from "@/lib/utils/submit-message";
const locked = {
  supported: true,
  localWeb: false,
  computer: false,
  screenRecording: false,
  accessibility: false,
};
const ready = {
  ...locked,
  computer: true,
  screenRecording: true,
  accessibility: true,
};
const part = {
  type: "tool-desktop_access_status",
  state: "output-available",
  output: { ok: true, access: locked },
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getDesktopAccessStatus).mockResolvedValue(locked);
});
it("asks inside chat without granting access on render, then continues only after explicit confirmation", async () => {
  jest.mocked(setDesktopAccess).mockResolvedValue(ready);
  render(<DesktopAccessStatusHandler part={part} status="ready" />);
  await screen.findByRole("button", { name: "Allow computer access" });
  expect(setDesktopAccess).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Allow computer access" }),
  );
  await screen.findByRole("button", { name: "Continue task" });
  expect(setDesktopAccess).toHaveBeenCalledWith("computer", true);
  expect(submitChatMessage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue task" }));
  expect(submitChatMessage).toHaveBeenCalledTimes(1);
});
it("does not announce readiness or continue when macOS permissions are missing", async () => {
  jest
    .mocked(setDesktopAccess)
    .mockResolvedValue({ ...locked, computer: true });
  render(<DesktopAccessStatusHandler part={part} status="ready" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Allow computer access" }),
  );
  await screen.findByRole("button", { name: "Open Screen Recording" });
  expect(
    screen.getByRole("button", { name: "Open Accessibility" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Continue task" }),
  ).not.toBeInTheDocument();
});
it("keeps rejected native consent visible without falsely enabling access", async () => {
  jest.mocked(setDesktopAccess).mockResolvedValue(locked);
  render(<DesktopAccessStatusHandler part={part} status="ready" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Allow computer access" }),
  );
  await waitFor(() => expect(setDesktopAccess).toHaveBeenCalled());
  expect(
    screen.queryByRole("button", { name: "Continue task" }),
  ).not.toBeInTheDocument();
});
it("does not offer live authorization in read-only historical output", () => {
  render(<DesktopAccessStatusHandler part={part} status="ready" readOnly />);
  expect(
    screen.queryByRole("button", { name: "Allow computer access" }),
  ).not.toBeInTheDocument();
});

it("does not invite another turn after a successful already-ready probe", async () => {
  jest.mocked(getDesktopAccessStatus).mockResolvedValue(ready);
  await act(async () => {
    render(
      <DesktopAccessStatusHandler
        part={{ ...part, output: { ok: true, access: ready } }}
        status="ready"
      />,
    );
  });
  expect(
    screen.queryByRole("region", { name: "Desktop permission" }),
  ).not.toBeInTheDocument();
  expect(submitChatMessage).not.toHaveBeenCalled();
});

it.each([
  {
    error:
      "The selected model cannot receive desktop screenshots. Select a vision-capable model for computer control.",
  },
  {
    code: "outcome_unknown",
    error: "The input may have happened but its acknowledgement was lost.",
  },
  { error: "Take a fresh desktop_screenshot and inspect it before input." },
])(
  "does not offer permission recovery for unrelated desktop failures: $error",
  async (failure) => {
    jest.mocked(getDesktopAccessStatus).mockResolvedValue(ready);
    await act(async () => {
      render(
        <DesktopAccessStatusHandler
          part={{
            ...part,
            type: "tool-desktop_screenshot",
            output: { ok: false, ...failure },
          }}
          status="ready"
        />,
      );
    });
    expect(screen.getByText(failure.error)).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Desktop permission" }),
    ).not.toBeInTheDocument();
    expect(getDesktopAccessStatus).not.toHaveBeenCalled();
  },
);

it("offers continuation when a failed connection is now locally ready", async () => {
  jest.mocked(getDesktopAccessStatus).mockResolvedValue(ready);
  render(
    <DesktopAccessStatusHandler
      part={{
        ...part,
        output: {
          ok: false,
          code: "unavailable",
          error: "Desktop connection unavailable.",
        },
      }}
      status="ready"
    />,
  );
  expect(
    await screen.findByRole("button", { name: "Continue task" }),
  ).toBeInTheDocument();
});

it("refreshes missing macOS permissions after returning from settings", async () => {
  jest
    .mocked(getDesktopAccessStatus)
    .mockResolvedValue({ ...locked, computer: true });
  render(<DesktopAccessStatusHandler part={part} status="ready" />);
  await screen.findByRole("button", { name: "Open Screen Recording" });
  jest.mocked(getDesktopAccessStatus).mockResolvedValue(ready);
  fireEvent(window, new Event("focus"));
  expect(
    await screen.findByRole("button", { name: "Continue task" }),
  ).toBeInTheDocument();
});
