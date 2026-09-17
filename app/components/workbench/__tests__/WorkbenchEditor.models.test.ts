import { disposeClosedWorkbenchModels } from "../WorkbenchEditor";

function model(uri: string) {
  return {
    uri: { toString: () => uri },
    dispose: jest.fn(),
  };
}

describe("Workbench editor model lifecycle", () => {
  it("disposes closed Workbench models without touching open or foreign models", () => {
    const open = model("file:///workspace/src/open.ts");
    const closed = model("file:///workspace/src/closed.ts");
    const spaced = model("file:///workspace/src/app%20shell/page.tsx");
    const foreign = model("file:///tmp/other-editor.ts");
    const monaco = {
      editor: { getModels: () => [open, closed, spaced, foreign] },
    };

    disposeClosedWorkbenchModels(monaco as never, [
      "src/open.ts",
      "src/app shell/page.tsx",
    ]);

    expect(open.dispose).not.toHaveBeenCalled();
    expect(spaced.dispose).not.toHaveBeenCalled();
    expect(foreign.dispose).not.toHaveBeenCalled();
    expect(closed.dispose).toHaveBeenCalledTimes(1);
  });

  it("releases every Workbench-owned model during teardown", () => {
    const first = model("file:///workspace/src/first.ts");
    const second = model("file:///workspace/src/second.ts");
    const monaco = {
      editor: { getModels: () => [first, second] },
    };

    disposeClosedWorkbenchModels(monaco as never, []);

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });
});
