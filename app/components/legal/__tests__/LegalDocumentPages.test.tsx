import { cleanup, render, screen } from "@testing-library/react";
import PrivacyPolicyPage from "@/app/privacy-policy/page";
import RefundPolicyPage from "@/app/refund-policy/page";
import TermsOfServicePage from "@/app/terms-of-service/page";

const pages = [
  {
    Page: TermsOfServicePage,
    title: "Terms of Service",
    activeLabel: "Terms",
    activeHref: "/terms-of-service",
    sectionTitle: "User Responsibility and Indemnity",
    preservedCopy:
      "The user assumes full responsibility for any risks associated with their use of the Products.",
  },
  {
    Page: PrivacyPolicyPage,
    title: "Privacy Policy",
    activeLabel: "Privacy",
    activeHref: "/privacy-policy",
    sectionTitle: "Information Sharing and Disclosure",
    preservedCopy:
      "The Service includes AI-assisted software development, media generation, workspace tools, and authorized security testing features.",
  },
  {
    Page: RefundPolicyPage,
    title: "Refund Policy",
    activeLabel: "Refunds",
    activeHref: "/refund-policy",
    sectionTitle: "How to request a refund",
    preservedCopy:
      "If a request fails on our side and no usable output is produced, the credits (or free run) consumed by that request are automatically restored to your account; no action is required.",
  },
] as const;

function normalizedText(element: HTMLElement) {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

describe("RIFT legal document pages", () => {
  afterEach(cleanup);

  it.each(pages)(
    "renders the $title route with shared, accessible document structure",
    ({ Page, title, activeHref, activeLabel, sectionTitle, preservedCopy }) => {
      const { container } = render(<Page />);

      expect(
        screen.getByRole("heading", { level: 1, name: title }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("navigation", { name: "Legal documents" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: activeLabel })).not.toBeNull();
      expect(
        screen
          .getByRole("navigation", { name: "Legal documents" })
          .querySelector(`a[href="${activeHref}"]`),
      ).toHaveAttribute("aria-current", "page");
      expect(
        screen.getAllByRole("navigation", { name: "On this page" }),
      ).toHaveLength(2);
      expect(
        screen.getByRole("heading", { level: 2, name: sectionTitle }),
      ).toBeInTheDocument();
      expect(screen.getByText("July 20, 2026").closest("time")).toHaveAttribute(
        "datetime",
        "2026-07-20",
      );
      expect(
        screen.getByRole("link", { name: "Skip to content" }),
      ).toHaveAttribute("href", "#page-body");
      expect(normalizedText(container)).toContain(preservedCopy);
    },
  );

  it("renders in the brand's palette rather than one of its own", () => {
    // These documents used to run on a light grey page with a blue link colour,
    // so a reader who followed a footer link arrived somewhere that shared
    // nothing with the product. They now render inside the marketing shell —
    // which is itself on the landing's system, so the ground is white again.
    // That is not a return to where they started: the point of the guard is
    // that the palette comes from one place, and it now does.
    const { container } = render(<TermsOfServicePage />);
    const shell = container.firstElementChild as HTMLElement | null;

    expect(shell).toHaveClass("bg-[var(--x-ground)]");
    expect(shell?.getAttribute("style")).toContain("--x-ground: #ffffff");
    // No page-local palette: colours come from the shared tokens. The old page
    // ground and link blue stay banned by value; #141414 used to sit in this
    // list as the old body colour and was dropped when it became the shared
    // hairline token — a guard that bans a colour the design system now owns
    // fails on correct code.
    expect(container.innerHTML).not.toMatch(/#f7f8fa|#0a69d8/);
    // The positive half of the same claim: the shell carries the shared
    // palette, so there is nothing left for a page-local one to override.
    expect(shell?.getAttribute("style")).toContain("--border:");
    expect(shell?.getAttribute("style")).toContain("--signal-bright:");
    expect(container.innerHTML).not.toMatch(/PLACEHOLDER/);
  });
});
