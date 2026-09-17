import { render, screen, fireEvent, within } from "@testing-library/react";
import { EffectivePolicyTable } from "../EffectivePolicyTable";

const GUARDRAILS = [{ id: "rm-rf", name: "Destructive deletes", enabled: true }];

const renderTable = (overrides: Record<string, unknown> = {}) =>
  render(
    <EffectivePolicyTable
      userGuardrailOverrides={new Map()}
      productGuardrailDefaults={GUARDRAILS}
      {...overrides}
    />,
  );

describe("Effective policy in settings", () => {
  it("shows the value that will actually apply", () => {
    renderTable();
    expect(screen.getByText("Destructive deletes")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("opens a row to reveal which layer decided it", () => {
    // The value alone does not answer "where do I change this".
    renderTable();
    expect(screen.queryByText("Product default")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Destructive deletes/ }));
    expect(screen.getByText("Product default")).toBeInTheDocument();
    expect(screen.getByText("In effect")).toBeInTheDocument();
  });

  it("moves the decision to the user layer once they override it", () => {
    renderTable({ userGuardrailOverrides: new Map([["rm-rf", false]]) });
    expect(screen.getByText("Allowed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Destructive deletes/ }));
    const list = screen.getByText("User").closest("li")!;
    expect(within(list).getByText("In effect")).toBeInTheDocument();
  });

  it("explains why a layer cannot carry a setting rather than showing a blank", () => {
    // An organization exists in this product, so an empty row would read as
    // "nobody has configured this yet" instead of "this is not a thing".
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /Destructive deletes/ }));

    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(
      screen.getByText(/govern spend and membership/),
    ).toBeInTheDocument();
  });

  it("states that an agent cannot relax a guardrail", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /Destructive deletes/ }));
    expect(screen.getByText(/cannot be relaxed per agent/)).toBeInTheDocument();
  });

  it("reflects a selected agent's narrowing", () => {
    renderTable({
      agent: {
        name: "Buddy",
        permissionPreset: "read-only",
        concurrencyLimit: 2,
        approvalPolicy: "risky-actions",
      },
    });

    expect(screen.getByText("Read only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Permission ceiling/ }));
    expect(screen.getByText("Agent · Buddy")).toBeInTheDocument();
  });
});
