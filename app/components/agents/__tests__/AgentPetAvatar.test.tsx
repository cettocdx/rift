import { render, screen } from "@testing-library/react";

import type { AgentPetRoleId } from "@/lib/ai/agents/pet-roster";
import { AgentPetAvatar } from "../AgentPetAvatar";

const PETS: Array<{
  accessory: string;
  name: string;
  role: AgentPetRoleId;
  roleName: string;
  species: string;
}> = [
  {
    accessory: "hard hat and wrench",
    name: "Forge",
    role: "build-engineer",
    roleName: "Build Engineer",
    species: "bear",
  },
  {
    accessory: "stylus and pixel swatches",
    name: "Pixel",
    role: "product-designer",
    roleName: "Product Designer",
    species: "cat",
  },
  {
    accessory: "field binoculars",
    name: "Scout",
    role: "research",
    roleName: "Research",
    species: "fox",
  },
  {
    accessory: "headset and megaphone",
    name: "Echo",
    role: "marketing",
    roleName: "Marketing",
    species: "rabbit",
  },
  {
    accessory: "inspection lens",
    name: "Probe",
    role: "quality",
    roleName: "QA",
    species: "owl",
  },
  {
    accessory: "director clapper",
    name: "Frame",
    role: "video-director",
    roleName: "Video Director",
    species: "terrier",
  },
];

describe("AgentPetAvatar", () => {
  it.each(PETS)(
    "renders $name as a distinct accessible $species persona",
    ({ accessory, name, role, roleName, species }) => {
      render(
        <AgentPetAvatar
          accent="#67A2FF"
          agentName={name}
          role={role}
          roleName={roleName}
        />,
      );

      const avatar = screen.getByRole("img", {
        name: `${name}, ${roleName} agent pet. ${species} with ${accessory}.`,
      });
      expect(avatar).toHaveAttribute("data-pet-role", role);
      expect(avatar).toHaveAttribute("data-pet-species", species);
      expect(avatar).toHaveAttribute("data-pet-accessory", accessory);
    },
  );

  it("exposes selected and workflow states without relying on color", () => {
    const { rerender } = render(
      <AgentPetAvatar
        accent="#67A2FF"
        agentName="Forge"
        participating={false}
        role="build-engineer"
        roleName="Build Engineer"
        selected={false}
      />,
    );

    const avatar = screen.getByRole("img");
    expect(avatar).toHaveAttribute("data-selected", "false");
    expect(avatar).toHaveAttribute("data-workflow", "false");

    rerender(
      <AgentPetAvatar
        accent="#67A2FF"
        agentName="Forge"
        participating
        role="build-engineer"
        roleName="Build Engineer"
        selected
      />,
    );
    expect(avatar).toHaveAttribute("data-selected", "true");
    expect(avatar).toHaveAttribute("data-workflow", "true");
  });

  it("uses only local vector artwork", () => {
    const { container } = render(
      <AgentPetAvatar
        accent="#DF7F94"
        agentName="Frame"
        role="video-director"
        roleName="Video Director"
      />,
    );

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("image")).not.toBeInTheDocument();
  });
});
