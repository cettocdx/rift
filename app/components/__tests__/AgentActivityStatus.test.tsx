import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { AgentActivityStatus } from "../AgentActivityStatus";

describe("AgentActivityStatus", () => {
  it("keeps the ready state accessible without an idle badge or dot", () => {
    render(<AgentActivityStatus isLive={false} />);

    const status = screen.getByRole("status");
    expect(status).toHaveAccessibleName("Agent ready");
    expect(status).toHaveClass("sr-only");
    expect(screen.queryByText(/idle/i)).not.toBeInTheDocument();
    expect(status.querySelector("span")).toBeNull();
  });

  it("announces an active run without rendering a Live badge or dot", () => {
    render(<AgentActivityStatus isLive />);

    const status = screen.getByRole("status", {
      name: "Agent run in progress",
    });
    expect(status).toHaveClass("sr-only");
    expect(screen.queryByText(/^live$/i)).not.toBeInTheDocument();
    expect(status.querySelector("span")).toBeNull();
  });
});
