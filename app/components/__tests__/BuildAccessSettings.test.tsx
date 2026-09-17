import { fireEvent, render, screen } from "@testing-library/react";

import {
  BuildAccessSessionIndicator,
  BuildAccessSettings,
  type BuildDesktopGrant,
} from "../BuildAccessSettings";

const grant: BuildDesktopGrant = {
  grantId: "grant-1",
  name: "rift-cursor",
  rootPath: "/Users/demo/Developer/rift-cursor",
  writable: true,
  grantedAt: 1_721_000_000_000,
};

describe("BuildAccessSettings", () => {
  it("states the real web, localhost, browser, and computer boundaries", () => {
    render(
      <BuildAccessSettings
        desktopState="unavailable"
        grants={[]}
        onRequestAccess={jest.fn()}
        onRevokeAccess={jest.fn()}
      />,
    );

    expect(screen.getByText("Public web")).toBeVisible();
    expect(screen.getByText("Available")).toBeVisible();
    expect(screen.getByText("Build localhost")).toBeVisible();
    expect(screen.getByText("Sandbox only")).toBeVisible();
    expect(screen.getByText("Browser interaction")).toBeVisible();
    expect(screen.getByText("Approval required")).toBeVisible();
    expect(screen.getByText("Selected files")).toBeVisible();
    expect(screen.getByText("Desktop only")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Get desktop app" }),
    ).toHaveAttribute("href", "/download");
  });

  it("describes localhost on the selected local runner and grants ending on Quit", () => {
    render(
      <BuildAccessSettings
        localExecutionSelected
        desktopState="ready"
        grants={[]}
        onRequestAccess={jest.fn()}
        onRevokeAccess={jest.fn()}
      />,
    );
    expect(screen.getByText("Selected runner")).toBeVisible();
    expect(
      screen.getByText(
        "localhost points to the selected local runner’s computer.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Sandbox only")).not.toBeInTheDocument();
    expect(
      screen.getByText("Local grants expire when you quit the desktop app."),
    ).toBeVisible();
  });

  it("requests a native read or write grant as separate actions", () => {
    const onRequestAccess = jest.fn();
    render(
      <BuildAccessSettings
        desktopState="ready"
        grants={[]}
        onRequestAccess={onRequestAccess}
        onRevokeAccess={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share read only" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Share with write access" }),
    );

    expect(onRequestAccess).toHaveBeenNthCalledWith(1, false);
    expect(onRequestAccess).toHaveBeenNthCalledWith(2, true);
  });

  it("shows active session scope and lets the user revoke a grant", () => {
    const onRevokeAccess = jest.fn();
    render(
      <BuildAccessSettings
        desktopState="ready"
        grants={[grant]}
        onRequestAccess={jest.fn()}
        onRevokeAccess={onRevokeAccess}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("1 item shared");
    expect(screen.getByText("rift-cursor")).toBeVisible();
    expect(screen.getByText("Read and write")).toBeVisible();
    expect(
      screen.getByTitle("/Users/demo/Developer/rift-cursor"),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(onRevokeAccess).toHaveBeenCalledWith("grant-1");
  });

  it("keeps the compact Build activity status truthful", () => {
    const { rerender } = render(
      <BuildAccessSessionIndicator desktopState="ready" grantCount={0} />,
    );

    // The icons carry the scope, so the labels only name it. What matters is
    // that the quiet case does not imply access the session does not have.
    expect(screen.getByRole("status")).toHaveTextContent("Web");
    expect(screen.getByRole("status")).toHaveTextContent("Sandbox");
    expect(screen.getByRole("status")).toHaveTextContent("Computer");
    expect(screen.getByRole("status")).not.toHaveTextContent("shared");

    rerender(
      <BuildAccessSessionIndicator desktopState="ready" grantCount={2} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("2 items shared");
  });
});
