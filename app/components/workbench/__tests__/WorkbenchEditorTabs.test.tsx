import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchEditorTabs } from "../WorkbenchEditor";

const setActivePath = jest.fn();
const closeDocument = jest.fn();

jest.mock("../WorkbenchProvider", () => ({
  useWorkbench: () => ({
    state: {
      openTabs: ["src/alpha.ts", "src/beta.ts"],
      activePath: "src/alpha.ts",
      documents: {
        "src/alpha.ts": {
          content: "const alpha = 1;",
          savedContent: "const alpha = 1;",
          status: "ready",
        },
        "src/beta.ts": {
          content: "const beta = 2;",
          savedContent: "const beta = 1;",
          status: "ready",
        },
      },
    },
    actions: { setActivePath, closeDocument },
  }),
}));

describe("WorkbenchEditorTabs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses roving focus and selects the next file with arrow keys", async () => {
    const user = userEvent.setup();
    render(<WorkbenchEditorTabs />);

    const alpha = screen.getByRole("tab", { name: "alpha.ts" });
    const beta = screen.getByRole("tab", {
      name: "beta.ts, unsaved changes",
    });

    expect(alpha).toHaveAttribute("tabindex", "0");
    expect(beta).toHaveAttribute("tabindex", "-1");
    expect(beta).toHaveAttribute("aria-controls", "workbench-active-editor");

    alpha.focus();
    await user.keyboard("{ArrowRight}");

    expect(setActivePath).toHaveBeenCalledWith("src/beta.ts");
    expect(beta).toHaveFocus();
  });

  it("supports Home and End navigation and keeps close accessible", async () => {
    const user = userEvent.setup();
    render(<WorkbenchEditorTabs />);

    const alpha = screen.getByRole("tab", { name: "alpha.ts" });
    const beta = screen.getByRole("tab", {
      name: "beta.ts, unsaved changes",
    });

    alpha.focus();
    await user.keyboard("{End}");
    expect(setActivePath).toHaveBeenLastCalledWith("src/beta.ts");
    expect(beta).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Close beta.ts" }));
    expect(closeDocument).toHaveBeenCalledWith("src/beta.ts");
  });
});
