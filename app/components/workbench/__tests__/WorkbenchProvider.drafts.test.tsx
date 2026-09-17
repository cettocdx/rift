import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { WorkbenchAdapter } from "../types";
import { useWorkbench, WorkbenchProvider } from "../WorkbenchProvider";

const filePath = "src/app.ts";

function createAdapter(): WorkbenchAdapter {
  return {
    listDirectory: jest.fn(async () => ({
      path: "",
      entries: [],
      truncated: false,
    })),
    readFile: jest.fn(async (path: string) => ({
      path,
      content: "const value = 1;",
      revision: "revision-1",
      size: 16,
      modifiedAt: "2026-07-18T12:00:00.000Z",
    })),
    writeFile: jest.fn(),
    readGit: jest.fn(async () => ({ repositoryPath: null, status: null })),
    readGitDiff: jest.fn(),
    mutateGit: jest.fn(),
  } as WorkbenchAdapter;
}

function Harness() {
  const { state, actions } = useWorkbench();
  const activeDocument = state.documents[filePath];
  return (
    <div>
      <button type="button" onClick={() => void actions.openFile(filePath)}>
        Open
      </button>
      <button
        type="button"
        onClick={() => actions.updateDocument(filePath, "const value = 2;")}
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => {
          document.body.dataset.navigationAllowed = String(
            actions.confirmNavigation(),
          );
        }}
      >
        Leave
      </button>
      <output>{activeDocument?.content ?? "closed"}</output>
      <span>{state.activePath ?? "no-active-tab"}</span>
    </div>
  );
}

describe("WorkbenchProvider draft protection", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    delete document.body.dataset.navigationAllowed;
  });

  it("restores an unsaved buffer and guards unload/navigation", async () => {
    const firstAdapter = createAdapter();
    const first = render(
      <WorkbenchProvider adapter={firstAdapter} storageScope="project:alpha">
        <Harness />
      </WorkbenchProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("const value = 1;")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("const value = 2;")).toBeVisible();

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Your draft will remain available"),
    );
    expect(document.body.dataset.navigationAllowed).toBe("false");
    confirm.mockRestore();

    await waitFor(() => expect(window.sessionStorage.length).toBe(1), {
      timeout: 1_000,
    });
    first.unmount();

    const secondAdapter = createAdapter();
    render(
      <WorkbenchProvider adapter={secondAdapter} storageScope="project:alpha">
        <Harness />
      </WorkbenchProvider>,
    );

    expect(screen.getByText("const value = 2;")).toBeVisible();
    expect(screen.getByText(filePath)).toBeVisible();
    expect(secondAdapter.readFile).not.toHaveBeenCalled();
  });
});
