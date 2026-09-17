import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PricingPage from "../page";

jest.mock("@/app/components/ZauthPageShell", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("PricingPage", () => {
  it("connects every plan to the appropriate existing account flow", () => {
    render(<PricingPage />);

    expect(screen.getByRole("link", { name: "Start free" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: "Choose Pro" })).toHaveAttribute(
      "href",
      "/upgrade",
    );
    expect(screen.getByRole("link", { name: "Choose Max" })).toHaveAttribute(
      "href",
      "/upgrade?feature=hack",
    );
  });

  it("keeps plan actions in a logical keyboard order", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    // The page now carries the shared shell, so the skip link and navigation
    // come first, as they should. Start counting from the first plan action.
    screen.getByRole("link", { name: "Start free" }).focus();
    expect(screen.getByRole("link", { name: "Start free" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Choose Pro" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Choose Max" })).toHaveFocus();
  });

  it("lists Hack Workbench only on Max", () => {
    render(<PricingPage />);

    // Addressed by `data-plan`, not by walking up from the heading: the plan
    // name sits in a flex row with the Recommended label, so `parentElement`
    // is that row rather than the column. "Pro" is also the name of a credit
    // pack further down the page, which makes a text query ambiguous.
    const proCard = document.querySelector('[data-plan="pro"]');
    const maxCard = document.querySelector('[data-plan="max"]');

    expect(proCard).not.toBeNull();
    expect(maxCard).not.toBeNull();
    expect(within(proCard!).queryByText(/Hack Workbench/i)).toBeNull();
    expect(
      within(maxCard!).getByText("Exclusive Hack Workbench access"),
    ).toBeVisible();
  });

  it("renders the landing's own plan table rather than a second drawing of it", () => {
    const { container } = render(<PricingPage />);

    // The three cards at deliberately unequal widths are gone. They were a
    // real idea — the plan most people should read sat widest — and it lost to
    // consistency: a reader who clicks "Pricing" in the bar used to arrive at
    // a differently-shaped version of the table they had just scrolled past.
    // Emphasis is now carried by the Recommended label and the filled pill,
    // which survives the columns being equal.
    const columns = container.querySelectorAll("[data-plan]");
    expect(columns).toHaveLength(3);
    for (const column of columns) {
      expect(column).not.toHaveClass("lg:col-span-3", "lg:col-span-5");
    }
    expect(screen.getByText("Recommended")).toBeVisible();

    // Still not a table element — three ruled columns, which is what reads on
    // a phone once they stack.
    expect(container.querySelector("table")).not.toBeInTheDocument();

    // The packs are derived from TOKEN_PACKAGES, the ladder the checkout
    // charges, rather than transcribed beside it.
    expect(screen.getByText("Starter")).toBeVisible();
    expect(screen.getByText("200,000 credits")).toBeVisible();
    expect(screen.getByText("Scale")).toBeVisible();
    expect(screen.getByText("3,600,000 credits")).toBeVisible();
    expect(screen.getByText("+20%")).toBeVisible();
  });

});
