import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspacePageErrorBoundary } from "../WorkspacePageErrorBoundary";

describe("workspace page errors", () => {
  it("keeps the shell available and retries only the failed view", () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    let failing = true;
    function Page() {
      if (failing) throw new Error("server read limit");
      return <p>Gallery ready</p>;
    }
    try {
      render(
        <>
          <nav>Workspace navigation</nav>
          <WorkspacePageErrorBoundary resource="artifacts">
            <Page />
          </WorkspacePageErrorBoundary>
        </>,
      );
      expect(screen.getByRole("navigation")).toBeVisible();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn’t load artifacts",
      );
      expect(screen.queryByText("server read limit")).not.toBeInTheDocument();
      failing = false;
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(screen.getByText("Gallery ready")).toBeVisible();
    } finally {
      log.mockRestore();
    }
  });
});
