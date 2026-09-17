import { fireEvent, render, screen } from "@testing-library/react";
import { VerifyAppToolHandler } from "../VerifyAppToolHandler";

it("exposes the failed check and command output on demand", () => {
  render(
    <VerifyAppToolHandler
      status="ready"
      part={{
        state: "output-available",
        output: {
          ok: false,
          summary: "Browser check failed",
          checks: [
            { name: "production-build", ok: true, detail: "Build passed" },
            {
              name: "browser-runtime",
              ok: false,
              detail: "Navigation timed out",
              output: "page.goto: Timeout 20000ms exceeded",
            },
          ],
        },
      }}
    />,
  );
  expect(screen.getByText("Verification failed")).toBeInTheDocument();
  expect(screen.queryByText("Navigation timed out")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Verification failed/ }));
  expect(screen.getByText("Navigation timed out")).toBeVisible();
  expect(screen.getByText("page.goto: Timeout 20000ms exceeded")).toBeVisible();
  expect(screen.getByText("Build passed")).toBeVisible();
});
it.each(["input-available", "output-available"])(
  "never presents an incomplete %s result as passed",
  (state) => {
    render(<VerifyAppToolHandler status="ready" part={{ state }} />);
    expect(screen.getByText("Verification incomplete")).toBeInTheDocument();
    expect(screen.queryByText("Verification passed")).not.toBeInTheDocument();
  },
);
it("shows an execution error rather than hiding it", () => {
  render(
    <VerifyAppToolHandler
      status="ready"
      part={{ state: "output-error", errorText: "Sandbox unavailable" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Verification failed/ }));
  expect(screen.getByText("Sandbox unavailable")).toBeVisible();
});
it("distinguishes active verification from a completed result", () => {
  const { rerender } = render(
    <VerifyAppToolHandler
      status="streaming"
      part={{ state: "input-available" }}
    />,
  );
  expect(screen.getByText("Verifying app")).toBeInTheDocument();
  rerender(
    <VerifyAppToolHandler
      status="ready"
      part={{
        state: "output-available",
        output: {
          ok: true,
          checks: [{ name: "project", ok: true, detail: "Project found" }],
        },
      }}
    />,
  );
  expect(screen.getByText("Verification passed")).toBeInTheDocument();
});
