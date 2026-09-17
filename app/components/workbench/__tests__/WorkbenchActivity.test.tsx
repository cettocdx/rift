import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  WorkbenchActivityProvider,
  useOptionalWorkbenchActivityPublisher,
  useWorkbenchActivity,
} from "../WorkbenchActivity";

function ConnectionProbe() {
  const { interactiveTerminal } = useWorkbenchActivity();
  const publisher = useOptionalWorkbenchActivityPublisher();

  return (
    <button
      type="button"
      onClick={() =>
        publisher?.publishInteractiveTerminalConnection("connected")
      }
    >
      {interactiveTerminal}
    </button>
  );
}

describe("WorkbenchActivityProvider", () => {
  it("publishes the real interactive terminal connection state", () => {
    render(
      <WorkbenchActivityProvider>
        <ConnectionProbe />
      </WorkbenchActivityProvider>,
    );

    const connection = screen.getByRole("button", { name: "starting" });
    fireEvent.click(connection);
    expect(
      screen.getByRole("button", { name: "connected" }),
    ).toBeInTheDocument();
  });
});
