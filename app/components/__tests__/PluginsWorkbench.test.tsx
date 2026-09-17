import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { PluginsWorkbench } from "../PluginsWorkbench";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock("../McpMarketplace", () => ({
  McpMarketplace: function Fixture({
    extensionTabs,
    active,
  }: {
    extensionTabs?: ReactNode;
    active?: boolean;
  }) {
    const React = require("react") as typeof import("react");
    const [query, setQuery] = React.useState("");
    return (
      <div data-testid="plugins-marketplace" data-active={active}>
        {extensionTabs}
        <input
          aria-label="Search plugins"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select aria-label="Plugin category" defaultValue="all">
          <option value="all">All</option>
          <option value="design">Design</option>
        </select>
      </div>
    );
  },
}));

jest.mock("../SkillsPanel", () => ({
  SkillsPanel: function Fixture({
    extensionTabs,
    active,
  }: {
    extensionTabs?: ReactNode;
    active?: boolean;
  }) {
    const React = require("react") as typeof import("react");
    const [query, setQuery] = React.useState("");
    return (
      <div data-testid="skills-panel" data-active={active}>
        {extensionTabs}
        <input
          aria-label="Search skills"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
    );
  },
}));

const mockReplace = jest.fn();

function setUrl(query = "") {
  jest.mocked(useRouter).mockReturnValue({ replace: mockReplace } as never);
  jest
    .mocked(useSearchParams)
    .mockReturnValue(new URLSearchParams(query) as never);
}

describe("PluginsWorkbench URL tabs", () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it("opens Skills directly from ?tab=skills", async () => {
    setUrl("tab=skills");
    render(<PluginsWorkbench />);

    expect(await screen.findByRole("tab", { name: "Skills" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("skills-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("plugins-marketplace")).not.toBeInTheDocument();
  });

  it("writes tab selection back to the canonical URL", async () => {
    setUrl();
    render(<PluginsWorkbench />);

    expect(
      await screen.findByTestId("plugins-marketplace"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(mockReplace).toHaveBeenCalledWith("/plugins?tab=skills", {
      scroll: false,
    });

    fireEvent.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(mockReplace).toHaveBeenCalledWith("/plugins", { scroll: false });
  });

  it("falls back to Plugins for unsupported tab values", async () => {
    setUrl("tab=unknown");
    render(<PluginsWorkbench />);

    expect(await screen.findByRole("tab", { name: "Plugins" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByTestId("plugins-marketplace"),
    ).toBeInTheDocument();
  });

  it("uses the compact utility pill tab treatment", async () => {
    setUrl();
    const { container } = render(<PluginsWorkbench />);

    expect(container.firstElementChild).toHaveClass("bg-background");
    expect(container.firstElementChild).not.toHaveClass("dark:bg-[#181818]");

    expect(
      await screen.findByRole("tablist", { name: "Extensions" }),
    ).toHaveClass("rounded-lg", "bg-card/[0.14]");
    expect(await screen.findByRole("tab", { name: "Plugins" })).toHaveClass(
      "min-h-11",
      "touch-manipulation",
      "md:pointer-fine:h-7",
      "rounded-md",
      "text-ui-label",
    );
  });

  it("supports roving focus and arrow-key tab selection", async () => {
    setUrl();
    render(<PluginsWorkbench />);

    const pluginsTab = await screen.findByRole("tab", { name: "Plugins" });
    const skillsTab = screen.getByRole("tab", { name: "Skills" });

    expect(pluginsTab).toHaveAttribute("tabindex", "0");
    expect(skillsTab).toHaveAttribute("tabindex", "-1");

    pluginsTab.focus();
    fireEvent.keyDown(pluginsTab, { key: "ArrowRight" });

    expect(mockReplace).toHaveBeenCalledWith("/plugins?tab=skills", {
      scroll: false,
    });
    expect(skillsTab).toHaveFocus();

    fireEvent.keyDown(skillsTab, { key: "Home" });
    expect(mockReplace).toHaveBeenLastCalledWith("/plugins", {
      scroll: false,
    });
    expect(pluginsTab).toHaveFocus();
  });

  it("keeps the clicked tab focused when the URL changes panels", async () => {
    const user = userEvent.setup();
    setUrl();
    const { rerender } = render(<PluginsWorkbench />);
    const skillsTab = await screen.findByRole("tab", { name: "Skills" });

    await user.click(skillsTab);
    setUrl("tab=skills");
    rerender(<PluginsWorkbench />);
    await screen.findByTestId("skills-panel");

    expect(skillsTab).toHaveFocus();
    expect(skillsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Skills" })).toBe(skillsTab);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Skills");
  });

  it("keeps keyboard navigation working across URL-driven panel replacements", async () => {
    const user = userEvent.setup();
    setUrl();
    const { rerender } = render(<PluginsWorkbench />);
    const pluginsTab = await screen.findByRole("tab", { name: "Plugins" });
    const skillsTab = screen.getByRole("tab", { name: "Skills" });

    pluginsTab.focus();
    await user.keyboard("{ArrowRight}");
    setUrl("tab=skills");
    rerender(<PluginsWorkbench />);
    await screen.findByTestId("skills-panel");

    expect(skillsTab).toHaveFocus();
    expect(skillsTab).toHaveAttribute("tabindex", "0");
    expect(pluginsTab).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{Home}");
    expect(mockReplace).toHaveBeenLastCalledWith("/plugins", { scroll: false });
    setUrl();
    rerender(<PluginsWorkbench />);
    await screen.findByTestId("plugins-marketplace");

    expect(pluginsTab).toHaveFocus();
    expect(pluginsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).not.toContainElement(
      screen.getByRole("tablist"),
    );
  });

  it("preserves each visited panel's query, category, scroll and DOM while exposing only the active panel", async () => {
    const user = userEvent.setup();
    setUrl();
    const { rerender } = render(<PluginsWorkbench />);
    const pluginInput = await screen.findByRole("textbox", {
      name: "Search plugins",
    });
    expect(screen.queryByTestId("skills-panel")).toBeNull();
    await user.type(pluginInput, "Figma");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Plugin category" }),
      "design",
    );
    const pluginBody = screen.getByTestId("plugins-marketplace");
    pluginBody.scrollTop = 144;
    setUrl("tab=skills");
    rerender(<PluginsWorkbench />);
    const skillInput = await screen.findByRole("textbox", {
      name: "Search skills",
    });
    await user.type(skillInput, "review");
    expect(pluginBody).toBeInTheDocument();
    expect(pluginBody.closest('[role="tabpanel"]')).toHaveAttribute("hidden");
    expect(pluginBody.closest('[role="tabpanel"]')).toHaveAttribute("inert");
    expect(pluginBody).toHaveAttribute("data-active", "false");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    setUrl();
    rerender(<PluginsWorkbench />);
    expect(screen.getByRole("textbox", { name: "Search plugins" })).toBe(
      pluginInput,
    );
    expect(pluginInput).toHaveValue("Figma");
    expect(
      screen.getByRole("combobox", { name: "Plugin category" }),
    ).toHaveValue("design");
    expect(pluginBody.scrollTop).toBe(144);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    setUrl("tab=skills");
    rerender(<PluginsWorkbench />);
    expect(screen.getByRole("textbox", { name: "Search skills" })).toBe(
      skillInput,
    );
    expect(skillInput).toHaveValue("review");
  });

  it("discards panel state when leaving and re-entering the workbench", async () => {
    setUrl();
    const first = render(<PluginsWorkbench />);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Search plugins" }),
      { target: { value: "private draft" } },
    );
    first.unmount();
    render(<PluginsWorkbench />);
    expect(
      await screen.findByRole("textbox", { name: "Search plugins" }),
    ).toHaveValue("");
  });
});
