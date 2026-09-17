import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";

import { CapabilityFlow } from "../CapabilityFlow";
import { WorkflowOverview } from "../WorkflowOverview";

describe("marketing product integrity", () => {
  it("renders the workflow as a labeled, non-interactive overview", () => {
    const { container } = render(<WorkflowOverview />);

    expect(
      screen.getByRole("figure", {
        name: "RIFT workflow capability overview",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Non-interactive")).toBeInTheDocument();
    expect(container.querySelector("button, input, textarea")).toBeNull();
    expect(container).not.toHaveTextContent("localhost");
    expect(container).not.toHaveTextContent("scaffolded");
  });

  it("renders a static capability map without terminal or app controls", () => {
    const { container } = render(<CapabilityFlow variant="embedded" />);

    expect(
      screen.getByRole("figure", { name: "RIFT static capability map" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Static overview")).toBeInTheDocument();
    expect(container.querySelector("button, input, textarea")).toBeNull();
    expect(container).not.toHaveTextContent("subfinder");
    expect(container).not.toHaveTextContent("Sandbox ready");
  });

  it("hides the shared-chat stop control while a fork is pending", () => {
    const source = readFileSync(
      join(process.cwd(), "app/share/[shareId]/SharedChatView.tsx"),
      "utf8",
    );

    expect(source).toContain("disabled={isForking}");
    expect(source).toContain('status="ready"');
    expect(source).toContain("hideStop");
    expect(source).toContain("Creating your editable copy of this chat...");
  });
});
