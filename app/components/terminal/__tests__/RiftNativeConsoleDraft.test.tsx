import { act, fireEvent, render, screen } from "@testing-library/react";
import { RiftNativeConsole } from "../RiftNativeConsole";
import { getDesktopNativeConsole } from "@/app/services/desktop-native-console";
import { nativeSnapshot } from "@/packages/console/src/native-client";
jest.mock("@/app/services/desktop-native-console", () => ({
  getDesktopNativeConsole: jest.fn(),
  disconnectDesktopNativeConsole: jest.fn(),
}));
jest.mock("@/app/services/desktop-terminal-owner", () => ({
  DESKTOP_TERMINAL_OWNER_CHANGED_EVENT: "native-owner-changed",
}));
jest.mock("@/app/hooks/useDesktopWorkspaceAccess", () => ({
  useDesktopWorkspaceAccess: () => ({
    grants: [
      { grantId: "grant", name: "Project", writable: true, kind: "directory" },
    ],
    requestAccess: jest.fn(),
    busyAction: null,
    error: null,
  }),
}));
jest.mock("@/components/ui/cursor-thinking", () => ({
  CursorActivityGlyph: () => null,
}));
jest.mock("../RiftTerminalArt", () => ({ RiftTerminalArt: () => null }));
test("real composer retains draft across reconnect but clears it on owner change", async () => {
  let publish = () => {};
  const command = jest.fn(async () => ({ accepted: true }));
  const client = {
    snapshot: { ...nativeSnapshot(""), status: "ready" },
    command,
    subscribe: (fn: () => void) => {
      publish = fn;
      return () => {};
    },
  };
  (getDesktopNativeConsole as jest.Mock).mockResolvedValue(client);
  render(<RiftNativeConsole />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Message RIFT console"), {
    target: { value: "OLD OWNER PRIVATE DRAFT" },
  });
  await act(async () => {
    client.snapshot = { ...client.snapshot, status: "error" };
    publish();
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  });
  expect(
    (screen.getByLabelText("Message RIFT console") as HTMLTextAreaElement)
      .value,
  ).toBe("OLD OWNER PRIVATE DRAFT");
  await act(async () => {
    window.dispatchEvent(new Event("native-owner-changed"));
    publish();
  });
  expect(
    (screen.getByLabelText("Message RIFT console") as HTMLTextAreaElement)
      .value,
  ).toBe("");
  await act(async () => {
    client.snapshot = { ...client.snapshot, status: "ready" };
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  });
  fireEvent.keyDown(screen.getByLabelText("Message RIFT console"), {
    key: "Enter",
  });
  expect(command).not.toHaveBeenCalled();
});
