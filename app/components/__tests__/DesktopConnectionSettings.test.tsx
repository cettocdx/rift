import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DesktopConnectionSettings } from "../DesktopConnectionSettings";
const mockNative = jest.fn();
const mockStatus = jest.fn();
const mockSet = jest.fn();
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => mockNative(),
}));
jest.mock("@/app/services/desktop-local-access", () => ({
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT: "rift:desktop-local-access-changed",
  getDesktopAccessStatus: () => mockStatus(),
  setDesktopAccess: (...args: unknown[]) => mockSet(...args),
  openDesktopPermissionSettings: (...args: unknown[]) => mockSet(...args),
}));
const disconnected = {
  localWeb: false,
  computer: false,
  screenRecording: false,
  accessibility: false,
  supported: true,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockNative.mockReturnValue(true);
  mockStatus.mockResolvedValue(disconnected);
});
it("explains that a web tab alone cannot control the Mac", () => {
  mockNative.mockReturnValue(false);
  render(<DesktopConnectionSettings />);
  expect(
    screen.getByText(/Open RIFT Desktop with the same account/),
  ).toBeVisible();
  expect(mockStatus).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Connect Computer control" }),
  ).toBeNull();
});
it("shows automatic capability readiness without connect toggles", async () => {
  mockStatus.mockResolvedValue({
    ...disconnected,
    localWeb: true,
    computer: true,
    screenRecording: true,
    accessibility: true,
  });
  render(<DesktopConnectionSettings />);
  await waitFor(() => expect(screen.getAllByText("Ready")).toHaveLength(2));
  expect(
    screen.queryByRole("button", { name: /Connect|Disconnect/i }),
  ).toBeNull();
  expect(mockSet).not.toHaveBeenCalled();
});
it("shows missing OS permissions without claiming computer control is ready", async () => {
  mockStatus.mockResolvedValue({ ...disconnected, computer: true });
  render(<DesktopConnectionSettings />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Screen Recording" }),
  );
  await waitFor(() => expect(mockSet).toHaveBeenCalledWith("screen_recording"));
  expect(
    screen.getByText(/enable Screen Recording and Accessibility/),
  ).toBeVisible();
  expect(
    screen.queryByText("Screen Recording and Accessibility are ready."),
  ).toBeNull();
});
