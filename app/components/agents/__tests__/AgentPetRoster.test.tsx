import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";

import { AgentPetRoster } from "../AgentPetRoster";
import { parseAgentRosterConfiguration } from "@/lib/ai/agents/pet-roster";

jest.mock("convex/react", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

const syncRoster = jest.fn(async () => ({
  success: true,
  id: "managed-roster-skill",
}));

describe("AgentPetRoster", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.mocked(useQuery).mockReturnValue([] as never);
    jest.mocked(useMutation).mockReturnValue(syncRoster as never);
  });

  it("selects a default pet and syncs its typed crew contract", async () => {
    render(<AgentPetRoster />);

    const pixel = await screen.findByRole("button", {
      name: "Make Pixel the default agent",
    });
    expect(
      screen.getByRole("button", { name: "Make Forge the default agent" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(pixel);
    expect(pixel).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Pixel leads as Product Designer")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add to runtime" }));

    await waitFor(() => expect(syncRoster).toHaveBeenCalledTimes(1));
    const payload = syncRoster.mock.calls[0][0];
    expect(payload.description).toContain("Pixel is the default lead");
    expect(payload.instructions).toContain("Pixel, Product Designer");
    expect(
      parseAgentRosterConfiguration(payload.instructions)?.activeAgentId,
    ).toBe("product-designer");
  });

  it("does not let the default agent leave its own workflow", async () => {
    render(<AgentPetRoster />);

    const forgeSwitch = await screen.findByRole("switch", {
      name: "Include Forge in matching workflows",
    });
    expect(forgeSwitch).toBeChecked();
    expect(forgeSwitch).toBeDisabled();
    expect(screen.getByText("Default always joins")).toBeVisible();
  });

  it("renders six distinct local pet personas with explicit crew states", async () => {
    render(<AgentPetRoster />);

    const avatars = await screen.findAllByRole("img", { name: /agent pet/i });
    const rosterAvatars = avatars.filter(
      (avatar) => avatar.getAttribute("data-pet-role") !== null,
    );
    expect(
      new Set(rosterAvatars.map((avatar) => avatar.dataset.petSpecies)),
    ).toEqual(new Set(["bear", "cat", "fox", "rabbit", "owl", "terrier"]));

    expect(
      screen.getByRole("button", { name: "Make Forge the default agent" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("switch", {
        name: "Include Scout in matching workflows",
      }),
    ).toBeChecked();
  });
});
