import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({ chatPurpose: "security" }),
}));

jest.mock("@/app/components/studio/StudioDiscovery", () => ({
  StudioDiscovery: () => <div>Studio discovery</div>,
}));

jest.mock("@/app/components/pro/HomeCommandCenter", () => ({
  HomeCommandCenter: () => <div>Home command center</div>,
}));

const { ProEmptyHero } =
  jest.requireActual<typeof import("../ProEmptyHero")>("../ProEmptyHero");

describe("ProEmptyHero theme contract", () => {
  it("uses the authenticated shell foreground token", () => {
    render(<ProEmptyHero />);

    const heading = screen.getByRole("heading", {
      name: "What can I help you build?",
    });
    expect(heading).toHaveClass("text-foreground");
    expect(heading.className).not.toContain("text-[#");
  });
});
