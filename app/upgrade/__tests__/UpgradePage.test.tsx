import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import UpgradePage from "../page";

const mockUseQuery = jest.fn();
const mockRouterPush = jest.fn();

jest.mock("convex/react", () => ({
  useAction: () => jest.fn(),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

jest.mock("@/app/components/extra-usage", () => ({
  AddOnCreditsDialog: () => null,
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn() },
}));

describe("UpgradePage feature targeting", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseQuery.mockReturnValueOnce(null).mockReturnValueOnce({
      balancePoints: 0,
    });
    mockRouterPush.mockClear();
  });

  it("targets Max when opened from the Hack Workbench gate", async () => {
    render(
      await UpgradePage({
        searchParams: Promise.resolve({ feature: "hack" }),
      }),
    );

    expect(
      screen.getByRole("heading", {
        name: "Unlock Hack Workbench with Max",
      }),
    ).toBeVisible();
    expect(screen.getByText("Required for Hack")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Get Max for Hack Workbench" }),
    ).toBeEnabled();
    expect(screen.queryByText("Most popular")).not.toBeInTheDocument();
  });

  it("keeps Pro as the default recommendation for a normal upgrade", async () => {
    render(
      await UpgradePage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Upgrade your plan" }),
    ).toBeVisible();
    expect(screen.getByText("Most popular")).toBeVisible();
    expect(screen.getByRole("button", { name: "Get Pro" })).toBeEnabled();
    expect(document.querySelector("header")).toHaveAttribute(
      "data-tauri-drag-region",
    );
  });

  it("does not present a temporary zero balance while credits are loading", async () => {
    mockUseQuery.mockReset();
    mockUseQuery.mockReturnValue(undefined);

    render(
      await UpgradePage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByText("Loading credits")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.queryByText("0 credits")).not.toBeInTheDocument();
  });
});
