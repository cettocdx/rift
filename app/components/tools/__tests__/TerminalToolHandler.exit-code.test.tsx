import { render, screen } from "@testing-library/react";
import { TerminalToolHandler } from "../TerminalToolHandler";

jest.mock("../../../hooks/useToolSidebar", () => ({
  useToolSidebar: () => ({ openInSidebar: jest.fn(), sidebarContent: null }),
}));

type Part = Parameters<typeof TerminalToolHandler>[0]["part"];

const completedPart = (output: Record<string, unknown>): Part =>
  ({
    type: "tool-run_terminal_cmd",
    toolCallId: "call_1",
    state: "output-available",
    input: { command: "npm run build", action: "exec" },
    output,
  }) as unknown as Part;

const renderPart = (output: Record<string, unknown>) =>
  render(
    <TerminalToolHandler
      part={completedPart(output)}
      status="ready"
      message={{ id: "m1", role: "assistant", parts: [] } as never}
    />,
  );

describe("terminal rows and the exit code they already carry", () => {
  it("reports a non-zero exit as a failure, with the code (run_terminal_cmd nests it under result)", () => {
    // The row used to say Done for every completed command, so a failing build
    // and a passing one were indistinguishable while the evidence underneath
    // said otherwise. run_terminal_cmd reports the code under `result`, which is
    // the shape production actually emits.
    const { container } = renderPart({ result: { exitCode: 1, output: "boom" } });

    expect(container.querySelector('[data-ui="tool-block"]')).toHaveAttribute(
      "data-status",
      "error",
    );
    expect(screen.getByText(/exit 1/)).toBeInTheDocument();
  });

  it("also reads a top-level exit code when one is present", () => {
    const { container } = renderPart({ exitCode: 2, output: "boom" });

    expect(container.querySelector('[data-ui="tool-block"]')).toHaveAttribute(
      "data-status",
      "error",
    );
    expect(screen.getByText(/exit 2/)).toBeInTheDocument();
  });

  it("reports a zero exit as done", () => {
    const { container } = renderPart({ result: { exitCode: 0, output: "ok" } });

    expect(container.querySelector('[data-ui="tool-block"]')).toHaveAttribute(
      "data-status",
      "done",
    );
    expect(screen.queryByText(/exit/)).not.toBeInTheDocument();
  });

  it("stays neutral when there is no exit code to read", () => {
    // A backgrounded command reports a pid and no status. Unknown is not
    // failure, and marking it one would be the same class of lie in reverse.
    const { container } = renderPart({ pid: 4242, output: "started" });

    expect(container.querySelector('[data-ui="tool-block"]')).toHaveAttribute(
      "data-status",
      "done",
    );
    expect(screen.queryByText(/exit/)).not.toBeInTheDocument();
  });

  it("shows a stopped command as stopped, never a fabricated exit", () => {
    // A command the user cancelled never reported an exit code. It used to be
    // rewritten as exit 130 -- a real SIGINT result the process never produced.
    // Now it carries an honest aborted marker and renders as its own state.
    const { container } = renderPart({
      result: { output: "partial", aborted: true },
    });

    expect(container.querySelector('[data-ui="tool-block"]')).toHaveAttribute(
      "data-status",
      "stopped",
    );
    expect(screen.getByText(/stopped/)).toBeInTheDocument();
    expect(screen.queryByText(/exit/)).not.toBeInTheDocument();
  });

  it("shows the command duration when it took at least a second", () => {
    renderPart({ result: { exitCode: 0, output: "ok", durationMs: 4200 } });
    expect(screen.getByText(/4\.2s/)).toBeInTheDocument();
  });

  it("omits a sub-second duration to keep fast commands quiet", () => {
    renderPart({ result: { exitCode: 0, output: "ok", durationMs: 120 } });
    expect(screen.queryByText(/s$/)).not.toBeInTheDocument();
  });

  it("shows a stopped shell command as stopped", () => {
    const { container } = renderPart({ output: "partial", aborted: true });

    expect(container.querySelector('[data-ui="tool-block"]')).toHaveAttribute(
      "data-status",
      "stopped",
    );
  });
});
