import { render, screen } from "@testing-library/react";
import { KeyboardSettingsTab } from "../KeyboardSettingsTab";
import { ProShellProvider } from "../pro/ProShellContext";
jest.mock("@/app/hooks/useIsMac", () => ({ useIsMac: () => true }));
describe("Shortcut reference for the current surface", () => {
  it("does not advertise Classic chat search or IDE controls in the main app", () => {
    render(
      <ProShellProvider basePath="/">
        <KeyboardSettingsTab onOpenPalette={() => {}} />
      </ProShellProvider>,
    );
    expect(screen.getByText("Open the terminal dock")).toBeInTheDocument();
    expect(screen.queryByText("Search chats")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Toggle the bottom panel"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });
  it("shows IDE controls in the workspace", () => {
    render(
      <ProShellProvider basePath="/workspace">
        <KeyboardSettingsTab onOpenPalette={() => {}} />
      </ProShellProvider>,
    );
    expect(screen.getByText("Toggle the bottom panel")).toBeInTheDocument();
    expect(
      screen.queryByText("Open the terminal dock"),
    ).not.toBeInTheDocument();
  });
  it("retains search for the standard chat shell", () => {
    render(<KeyboardSettingsTab onOpenPalette={() => {}} />);
    expect(screen.getByText("Search chats")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });
});
