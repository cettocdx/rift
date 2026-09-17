import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";

import { SkillsPanel } from "../SkillsPanel";

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

const mockMutation = jest.fn(async () => ({
  success: true,
  id: "skill-installed",
}));

describe("SkillsPanel marketplace states", () => {
  beforeEach(() => {
    mockMutation.mockClear();
    jest.mocked(useQuery).mockReturnValue([] as never);
    jest.mocked(useMutation).mockReturnValue(mockMutation as never);
  });

  it("closes the portalled create dialog on deactivation while preserving search", () => {
    const { rerender } = render(<SkillsPanel />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), {
      target: { value: "photorealistic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(
      screen.getByRole("dialog", { name: "Create a skill" }),
    ).toBeInTheDocument();
    rerender(<SkillsPanel active={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<SkillsPanel />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search skills" })).toHaveValue(
      "photorealistic",
    );
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("searches the built-in catalog and filters it by category", () => {
    render(<SkillsPanel />);

    const search = screen.getByRole("textbox", { name: "Search skills" });
    fireEvent.change(search, { target: { value: "photorealistic" } });

    expect(screen.getByText("Photorealistic Prompting")).toBeInTheDocument();
    expect(screen.queryByText("Pentest Report Writer")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Image" }));

    expect(screen.getByText("Photorealistic Prompting")).toBeInTheDocument();
    expect(screen.getByText("Logo & Icon Prompting")).toBeInTheDocument();
    expect(screen.queryByText("Pentest Report Writer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Image" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("installs a built-in skill by catalog id without trusting browser-supplied instructions", async () => {
    render(<SkillsPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: "Add Pentest Report Writer" }),
    );

    await waitFor(() =>
      expect(mockMutation).toHaveBeenCalledWith({
        catalogId: "pentest-report",
      }),
    );
    expect(mockMutation.mock.calls[0]?.[0]).not.toHaveProperty("instructions");
  });

  it("shows installed, origin, and enabled states without calling disabled skills enabled", () => {
    jest.mocked(useQuery).mockReturnValue([
      {
        _id: "skill-1",
        name: "Pentest Report Writer",
        description: "Report writer",
        instructions: "Write a report",
        scope: "security",
        catalog_id: "pentest-report",
        enabled: false,
        created_at: 1,
        updated_at: 2,
      },
    ] as never);

    render(<SkillsPanel />);

    const installed = screen.getByRole("region", {
      name: /Installed/i,
    });
    expect(
      within(installed).getByText("Built-in · Disabled · Hack Workbench"),
    ).toBeInTheDocument();
    expect(
      within(installed).getByRole("switch", {
        name: "Enable Pentest Report Writer",
      }),
    ).not.toBeChecked();
    expect(screen.getAllByText("Installed").length).toBeGreaterThan(1);
  });
});
