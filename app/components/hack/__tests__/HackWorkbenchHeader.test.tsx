import { fireEvent, render, screen } from "@testing-library/react";
import { HackWorkbenchHeader } from "../HackWorkbenchHeader";

const defaults = {
  target: "",
  onTargetChange: jest.fn(),
  onRun: jest.fn(),
  onStop: jest.fn(),
  running: false,
  canRun: false,
  elapsed: "00:00",
  taskName: "Choose a task",
  sidebarOpen: true,
  onToggleSidebar: jest.fn(),
};
it("reserves a separate native titlebar and keeps the target outside its drag region", () => {
  render(<HackWorkbenchHeader {...defaults} />);
  const titlebar = screen.getByTestId("hack-titlebar");
  expect(titlebar).toHaveAttribute("data-tauri-drag-region");
  expect(titlebar).toHaveAttribute("data-rift-native-titlebar", "hack");
  expect(titlebar).toContainElement(
    screen.getByRole("link", { name: "Back to the RIFT app" }),
  );
  expect(titlebar).not.toContainElement(screen.getByRole("textbox"));
  expect(
    screen.getByRole("button", { name: "Run active operation" }),
  ).toBeDisabled();
});
it("keeps target typing, task navigation and run actions functional", () => {
  const onTargetChange = jest.fn(),
    onRun = jest.fn(),
    onToggleSidebar = jest.fn();
  render(
    <HackWorkbenchHeader
      {...defaults}
      target="localhost"
      canRun
      onTargetChange={onTargetChange}
      onRun={onRun}
      onToggleSidebar={onToggleSidebar}
    />,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "127.0.0.1" },
  });
  expect(onTargetChange).toHaveBeenCalledWith("127.0.0.1");
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(onRun).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Hide task sidebar" }));
  expect(onToggleSidebar).toHaveBeenCalledTimes(1);
});
it("stops only through the stop button while busy, not by pressing Enter in the scope", () => {
  const onRun = jest.fn(),
    onStop = jest.fn();
  render(
    <HackWorkbenchHeader
      {...defaults}
      running
      elapsed="01:23"
      onRun={onRun}
      onStop={onStop}
    />,
  );
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(onRun).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Stop active operation" }),
  );
  expect(onStop).toHaveBeenCalledTimes(1);
  expect(screen.getByText("01:23")).toBeVisible();
});

it("keeps fresh assessment and history navigation available during work without stopping or running", () => {
  const onNewAssessment = jest.fn(),
    onRun = jest.fn(),
    onStop = jest.fn();
  render(
    <HackWorkbenchHeader
      {...defaults}
      running
      onNewAssessment={onNewAssessment}
      onRun={onRun}
      onStop={onStop}
    />,
  );
  const fresh = screen.getByRole("button", { name: "New assessment" });
  expect(fresh).toBeEnabled();
  expect(fresh).not.toHaveAttribute("data-tauri-drag-region");
  fireEvent.click(fresh);
  expect(onNewAssessment).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Assessment history" }),
    { key: "Enter" },
  );
  expect(screen.getByRole("menuitem", { name: "All runs" })).toHaveAttribute(
    "href",
    "/runs",
  );
  expect(onRun).not.toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});

it("offers the previous assessment in the keyboard-accessible history menu without affecting active work", () => {
  const previous = jest.fn(),
    stop = jest.fn(),
    run = jest.fn();
  render(
    <HackWorkbenchHeader
      {...defaults}
      running
      onPreviousAssessment={previous}
      onStop={stop}
      onRun={run}
    />,
  );
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Assessment history" }),
    { key: "Enter" },
  );
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Previous assessment" }),
  );
  expect(previous).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
