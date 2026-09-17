import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthUser } from "@/app/hooks/useAuth";

import SidebarUserNav, {
  getSidebarDisplayName,
  getSidebarPlanLabel,
} from "../SidebarUserNav";

let mockSubscription = "pro";
let mockSubscriptionReady = true;
let mockCheckingProPlan = false;

const mockAuthUser: AuthUser = {
  id: "user-1",
  email: "emre.cetinkaya@example.com",
  firstName: "Emre",
  lastName: "Cetinkaya",
  profilePictureUrl: null,
  name: "Emre Cetinkaya",
};

jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockAuthUser,
    loading: false,
    isAuthenticated: true,
    entitlements: [],
    entitlementsReady: true,
  }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    subscription: mockSubscription,
    isSubscriptionReady: mockSubscriptionReady,
    isCheckingProPlan: mockCheckingProPlan,
  }),
}));

jest.mock("convex/react", () => ({
  useQuery: () => ({ balancePoints: 0 }),
}));

jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setTheme: jest.fn() }),
}));

jest.mock("@/app/components/usage/MonthlyUsageSummary", () => ({
  MonthlyUsageSummary: ({
    isCollapsed,
    subscription,
  }: {
    isCollapsed?: boolean;
    subscription: string;
  }) => (
    <button
      type="button"
      data-testid="monthly-usage-summary"
      data-collapsed={String(Boolean(isCollapsed))}
      data-subscription={subscription}
    >
      Monthly usage
    </button>
  ),
}));

jest.mock("@/app/components/ReferralRewardDialog", () => ({
  ReferralRewardDialog: () => null,
}));

describe("Pro sidebar account identity", () => {
  beforeEach(() => {
    mockSubscription = "pro";
    mockSubscriptionReady = true;
    mockCheckingProPlan = false;
    mockAuthUser.profilePictureUrl = null;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(["standard", "name-only"] as const)(
    "%s profile picture",
    (identityMode) => {
      it("shows the provider picture beside the name once it loads", () => {
        mockAuthUser.profilePictureUrl =
          "https://lh3.googleusercontent.com/profile-photo";
        // Keep the real Radix Avatar and control only the browser image load.
        const image = document.createElement("img");
        jest.spyOn(window, "Image").mockImplementation(() => image);
        render(<SidebarUserNav identityMode={identityMode} />);

        const accountTrigger = screen.getByTestId("user-menu-button");
        expect(within(accountTrigger).getByText("EC")).toBeVisible();
        fireEvent.load(image);

        const picture = within(accountTrigger).getByAltText(
          identityMode === "name-only" ? "" : "Emre Cetinkaya",
        );
        expect(picture).toHaveAttribute("src", mockAuthUser.profilePictureUrl);
        expect(picture).toBeVisible();
        expect(within(accountTrigger).queryByText("EC")).toBeNull();
        expect(
          within(accountTrigger).getByText("Emre Cetinkaya"),
        ).toBeVisible();
      });

      it("keeps initials when no profile picture is available", () => {
        render(<SidebarUserNav identityMode={identityMode} />);

        const accountTrigger = screen.getByTestId("user-menu-button");
        expect(within(accountTrigger).getByText("EC")).toBeVisible();
        expect(accountTrigger.querySelector("img")).toBeNull();
      });

      it("keeps initials when the profile picture cannot load", () => {
        mockAuthUser.profilePictureUrl = "https://example.com/missing-photo";
        const image = document.createElement("img");
        jest.spyOn(window, "Image").mockImplementation(() => image);
        render(<SidebarUserNav identityMode={identityMode} />);
        fireEvent.error(image);

        const accountTrigger = screen.getByTestId("user-menu-button");
        expect(within(accountTrigger).getByText("EC")).toBeVisible();
        expect(accountTrigger.querySelector("img")).toBeNull();
      });
    },
  );

  it("uses the exact profile name before legacy fields or email fallbacks", () => {
    expect(
      getSidebarDisplayName({
        email: "fallback.name@example.com",
        firstName: "Legacy",
        lastName: "Name",
        name: "  Emre Ahmet Cetinkaya  ",
      }),
    ).toBe("Emre Ahmet Cetinkaya");
  });

  it("turns an email local part into a readable name for older profiles", () => {
    expect(
      getSidebarDisplayName({
        email: "ada.lovelace+desktop@example.com",
        firstName: null,
        lastName: null,
        name: null,
      }),
    ).toBe("Ada Lovelace");
  });

  it("does not expose a legacy generic User placeholder", () => {
    expect(
      getSidebarDisplayName({
        email: "emre.cetinkaya@example.com",
        firstName: "User",
        lastName: null,
        name: "User",
      }),
    ).toBe("Emre Cetinkaya");
  });

  it.each([
    ["free", "Free"],
    ["pro", "Pro"],
    ["pro-plus", "Pro"],
    ["team", "Pro"],
    ["ultra", "Max"],
  ] as const)(
    "maps the %s source tier to the %s public plan",
    (tier, label) => {
      expect(getSidebarPlanLabel(tier)).toBe(label);
    },
  );

  it("keeps usage visible and renders one clean name-only account trigger", async () => {
    const user = userEvent.setup();
    render(<SidebarUserNav identityMode="name-only" />);

    expect(screen.getByTestId("monthly-usage-summary")).toHaveAttribute(
      "data-subscription",
      "pro",
    );

    const accountTrigger = screen.getByRole("button", {
      name: "Account menu for Emre Cetinkaya, Pro",
    });
    expect(accountTrigger).toHaveAttribute("aria-haspopup", "menu");
    expect(within(accountTrigger).getByText("Emre Cetinkaya")).toBeVisible();
    expect(within(accountTrigger).getByText("Pro")).toBeVisible();
    expect(screen.getByTestId("sidebar-membership-tier")).toHaveAttribute(
      "aria-label",
      "Pro membership",
    );
    // The provider's picture rides along with the name — someone who signed in
    // with Google should see the face they signed in with. Its initials
    // fallback is the only other thing in the row.
    // The reference editor's account row: name over plan, no separator glyph
    // between them -- the plan is a fact about the account and sits under the
    // name in the quiet ink.
    expect(accountTrigger).toHaveTextContent(/^ECEmre CetinkayaPro$/);
    // No rule between name and plan; the row carries the affordance that says
    // it opens a menu.
    expect(
      accountTrigger.querySelector('[data-testid="sidebar-membership-tier"]'),
    ).not.toHaveClass("border-l");
    expect(accountTrigger.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-user-email")).not.toBeInTheDocument();

    await user.click(accountTrigger);
    expect(await screen.findByTestId("settings-button")).toBeVisible();
  });

  it("shows a quiet loading fallback until subscription resolution finishes", () => {
    mockSubscriptionReady = false;
    render(<SidebarUserNav identityMode="name-only" />);

    expect(
      screen.getByRole("button", {
        name: "Account menu for Emre Cetinkaya",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("sidebar-membership-tier")).toHaveTextContent(
      "…",
    );
    expect(screen.getByTestId("sidebar-membership-tier")).toHaveAttribute(
      "aria-label",
      "Membership loading",
    );
  });

  it("leaves the standard account presentation available outside Pro desktop", () => {
    render(<SidebarUserNav />);

    const accountTrigger = screen.getByRole("button", {
      name: "Account menu for Emre Cetinkaya",
    });
    expect(within(accountTrigger).getByText("Emre Cetinkaya")).toBeVisible();
    expect(screen.getByTestId("sidebar-user-email")).toHaveTextContent(
      "emre.cetinkaya@example.com",
    );
    expect(accountTrigger.querySelector("svg")).toBeInTheDocument();
  });
});
