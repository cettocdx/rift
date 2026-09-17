import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchExplorer } from "../WorkbenchExplorer";

const mockActions = {
  loadDirectory: jest.fn(),
  toggleDirectory: jest.fn(),
  openFile: jest.fn(),
};
const mockSetSurface = jest.fn();
let mockState: any;
jest.mock("../WorkbenchProvider", () => ({
  useWorkbench: () => ({
    state: mockState,
    actions: mockActions,
    meta: { workspaceLabel: "workspace" },
  }),
}));
jest.mock("../WorkbenchMobileNavigation", () => ({
  useOptionalMobileNavigation: () => ({ setSurface: mockSetSurface }),
}));
const folder = { name: "src", path: "src", type: "directory" };
const file = { name: "hello.ts", path: "src/hello.ts", type: "file" };
const readme = { name: "README.md", path: "README.md", type: "file" };
const item = (name: string) =>
  screen.getByRole("treeitem", { name, exact: true });
beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    activePath: null,
    expandedDirectories: new Set(),
    directories: {
      "": { entries: [folder, readme] },
      src: { entries: [file] },
    },
  };
});

test("one tab stop navigates visible rows without opening files", async () => {
  const user = userEvent.setup();
  render(<WorkbenchExplorer />);
  await user.tab();
  expect(
    screen.getByRole("button", { name: "Refresh Explorer" }),
  ).toHaveFocus();
  await user.tab();
  expect(item("src")).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(item("README.md")).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(item("src")).toHaveFocus();
  await user.keyboard("{End}");
  expect(item("README.md")).toHaveFocus();
  await user.keyboard("{Home}");
  expect(item("src")).toHaveFocus();
  expect(
    screen.getAllByRole("treeitem").filter((node) => node.tabIndex === 0),
  ).toHaveLength(1);
  await user.tab();
  expect(item("README.md")).not.toHaveFocus();
  expect(mockActions.openFile).not.toHaveBeenCalled();
});

test("right expands then enters children; left returns to parent then collapses", () => {
  const view = render(<WorkbenchExplorer />);
  act(() => item("src").focus());
  fireEvent.keyDown(item("src"), { key: "ArrowRight" });
  expect(mockActions.toggleDirectory).toHaveBeenCalledWith("src");
  mockState.expandedDirectories = new Set(["src"]);
  view.rerender(<WorkbenchExplorer />);
  fireEvent.keyDown(item("src"), { key: "ArrowRight" });
  expect(item("hello.ts")).toHaveFocus();
  fireEvent.keyDown(item("hello.ts"), { key: "ArrowLeft" });
  expect(item("src")).toHaveFocus();
  fireEvent.keyDown(item("src"), { key: "ArrowLeft" });
  expect(mockActions.toggleDirectory).toHaveBeenCalledTimes(2);
});

test("Enter, Space, and pointer activation open files and switch the mobile editor", () => {
  render(<WorkbenchExplorer />);
  for (const key of ["Enter", " "])
    fireEvent.keyDown(item("README.md"), { key });
  fireEvent.click(item("README.md").firstElementChild!);
  expect(mockActions.openFile).toHaveBeenCalledTimes(3);
  expect(mockActions.openFile).toHaveBeenLastCalledWith("README.md");
  expect(mockSetSurface).toHaveBeenCalledTimes(3);
  expect(mockSetSurface).toHaveBeenLastCalledWith("editor");
});

test("focus returns to a parent when its focused child disappears", () => {
  mockState.expandedDirectories = new Set(["src"]);
  const view = render(<WorkbenchExplorer />);
  act(() => item("hello.ts").focus());
  mockState.expandedDirectories = new Set();
  view.rerender(<WorkbenchExplorer />);
  expect(item("src")).toHaveFocus();
  expect(item("src")).toHaveAttribute("tabindex", "0");
});

test("nested file activation does not toggle its ancestor directory", () => {
  mockState.expandedDirectories = new Set(["src"]);
  render(<WorkbenchExplorer />);
  fireEvent.click(item("hello.ts"));
  expect(mockActions.openFile).toHaveBeenCalledWith("src/hello.ts");
  expect(mockActions.toggleDirectory).not.toHaveBeenCalled();
  expect(item("hello.ts")).toHaveFocus();
});

test("changes outside the Explorer do not steal focus back into its tree", () => {
  const view = render(<WorkbenchExplorer />);
  act(() => item("src").focus());
  act(() => item("src").blur());
  mockState.expandedDirectories = new Set(["src"]);
  view.rerender(<WorkbenchExplorer />);
  expect(document.body).toHaveFocus();
});
