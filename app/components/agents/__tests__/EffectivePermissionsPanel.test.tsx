import { render, screen } from "@testing-library/react";
import { EffectivePermissionsPanel } from "../EffectivePermissionsPanel";

const profile = (overrides: Record<string, unknown> = {}) =>
  ({
    permissionPreset: "workspace-write",
    toolIds: ["file", "run_terminal_cmd"],
    mcpServerIds: [],
    concurrencyLimit: 2,
    escalationPolicy: "when-blocked",
    approvalPolicy: "risky-actions",
    autonomy: "balanced",
    ...overrides,
  }) as never;

describe("Effective permissions, shown before save", () => {
  it("warns about a tool the profile selected but the runtime will withhold", () => {
    // A ticked terminal tool on a read-only agent reads as granted and is not.
    // That gap is where a dangerous assumption forms.
    render(
      <EffectivePermissionsPanel
        profile={profile({
          permissionPreset: "read-only",
          toolIds: ["file", "run_terminal_cmd"],
        })}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("run_terminal_cmd");
    expect(screen.getByRole("status")).toHaveTextContent(
      /will not be available at run time/,
    );
  });

  it("confirms plainly when nothing is withheld", () => {
    render(<EffectivePermissionsPanel profile={profile()} />);
    expect(
      screen.getByText(/Every selected tool is available/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("distinguishes what is enforced from what is only advised", () => {
    // Escalation and approval shape the prompt; nothing stops a model from
    // pressing on. Presenting them as guarantees would be false assurance.
    const { container } = render(
      <EffectivePermissionsPanel profile={profile()} />,
    );
    const panel = container.querySelector('[data-ui="effective-permissions"]')!;

    expect(panel).toHaveTextContent("Filesystem");
    expect(screen.getAllByText("Enforced").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Advisory").length).toBeGreaterThan(0);
  });

  it("does not claim trusted widens the filesystem boundary", () => {
    render(
      <EffectivePermissionsPanel
        profile={profile({ permissionPreset: "trusted" })}
      />,
    );
    expect(screen.getByText(/still bounds every path/)).toBeInTheDocument();
  });

  it("says when no network tool was granted", () => {
    render(
      <EffectivePermissionsPanel profile={profile({ toolIds: ["file"] })} />,
    );
    expect(screen.getByText("No network tools granted")).toBeInTheDocument();
  });

  it("counts tools a selected MCP server contributes", () => {
    render(
      <EffectivePermissionsPanel
        profile={profile({ mcpServerIds: ["srv-1"] })}
        availableMcpToolIdsByServer={{ "srv-1": ["a", "b"] }}
      />,
    );
    // file + run_terminal_cmd + find_skills + 2 MCP tools
    expect(screen.getByText("5 granted")).toBeInTheDocument();
  });
});
