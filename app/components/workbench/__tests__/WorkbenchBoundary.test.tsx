import { act, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, lazy, useState } from "react";
import { WorkbenchBoundary } from "../WorkbenchBoundary";

it("keeps the conversation, draft and dock controls mounted while a first-use panel loads", async () => {
  let finish!: (module: { default: () => React.ReactNode }) => void;
  const ColdPanel = lazy(
    () =>
      new Promise<{ default: () => React.ReactNode }>((resolve) => {
        finish = resolve;
      }),
  );
  function App() {
    const [open, setOpen] = useState(false);
    return (
      <Suspense fallback={<p>Entire app loading</p>}>
        <article>Existing answer</article>
        <input aria-label="Draft" defaultValue="Unsent work" />
        <button onClick={() => setOpen(true)}>Open activity</button>
        <section aria-label="Workspace">
          <header>Activity controls</header>
          {open && (
            <WorkbenchBoundary>
              <ColdPanel />
            </WorkbenchBoundary>
          )}
        </section>
      </Suspense>
    );
  }
  render(<App />);
  const answer = screen.getByText("Existing answer");
  const draft = screen.getByRole("textbox", {
    name: "Draft",
  }) as HTMLInputElement;
  draft.focus();
  draft.setSelectionRange(3, 3);
  fireEvent.click(screen.getByRole("button", { name: "Open activity" }));
  expect(screen.queryByText("Entire app loading")).not.toBeInTheDocument();
  expect(answer).toBeVisible();
  expect(screen.getByText("Activity controls")).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Loading workspace panel" }),
  ).toBeVisible();
  expect(draft).toHaveFocus();
  expect(draft.selectionStart).toBe(3);
  await act(async () => finish({ default: () => <p>Operations loaded</p> }));
  expect(screen.getByText("Operations loaded")).toBeVisible();
  expect(screen.getByText("Existing answer")).toBe(answer);
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft).toHaveValue("Unsent work");
});
