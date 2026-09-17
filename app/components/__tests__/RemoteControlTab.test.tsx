import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, jest } from "@jest/globals";

jest.mock("../LocalRunnerSettingsCard", () => ({
  LocalRunnerSettingsCard: () => <div>Local runner connection</div>,
}));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({ sandboxPreference: "e2b" }),
}));

jest.mock("@/app/hooks/useDesktopWorkspaceAccess", () => ({
  useDesktopWorkspaceAccess: () => ({
    busyAction: null,
    desktopState: "unavailable",
    error: null,
    grants: [],
    requestAccess: jest.fn(),
    revokeAccess: jest.fn(),
  }),
}));

const { RemoteControlTab } = jest.requireActual<
  typeof import("../RemoteControlTab")
>("../RemoteControlTab");

describe("RemoteControlTab", () => {
  it("shows truthful Build access boundaries outside the desktop app", () => {
    render(<RemoteControlTab />);
    expect(screen.getByText("Local runner connection")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Build access" })).toBeVisible();
    expect(screen.getByText("Public web")).toBeVisible();
    expect(screen.getByText("Sandbox only")).toBeVisible();
    expect(screen.getByText("Approval required")).toBeVisible();
    expect(screen.getByText("Desktop only")).toBeVisible();
  });
});
