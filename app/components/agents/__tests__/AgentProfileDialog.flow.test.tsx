import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { createProjectBotProfile } from "@/lib/ai/agents/project-bot-templates";
import { AgentProfileDialog } from "../AgentProfileDialog";

// The default pet ("dog") suggests these, so a fresh draft is already valid
// on the skills step -- the flow can reach Review without hand-picking skills.
const SKILLS = [
  "react-best-practices",
  "concise-expert",
  "sql-data",
  "ui-ux-pro-max",
].map((id) => ({
  id,
  name: id,
  description: id,
  enabled: true,
  source: "installed" as const,
}));

function renderDialog(overrides: Record<string, unknown> = {}) {
  const onSave = jest.fn(async () => {});
  const onSaveAndTest = jest.fn(async () => {});
  render(
    <AgentProfileDialog
      installedSkills={SKILLS}
      mcpServers={[]}
      onClose={jest.fn()}
      onSave={onSave}
      onSaveAndTest={onSaveAndTest}
      open
      saving={false}
      {...overrides}
    />,
  );
  return { onSave, onSaveAndTest };
}

/** Advances the wizard to the review step via Next. */
function goToReview() {
  for (let i = 0; i < 4; i += 1) {
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  }
}

describe("Agent creation: a guided five-step flow", () => {
  it("presents five steps and starts on the first", () => {
    renderDialog();
    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument();
    // The rail carries the new Review & test step.
    expect(
      screen.getByRole("button", { name: /Review & test/ }),
    ).toBeInTheDocument();
  });

  it("walks forward and back through the steps", () => {
    renderDialog();
    // No Back on the first step.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText(/Step 2 of 5/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument();
  });

  it("shows effective permissions and a test prompt on the review step, not a bare Next", () => {
    renderDialog();
    goToReview();

    expect(screen.getByText(/Step 5 of 5/)).toBeInTheDocument();
    // The gap between the form and the runtime is closed before save.
    expect(screen.getByLabelText("Effective permissions")).toBeInTheDocument();
    expect(screen.getByLabelText(/Test prompt/)).toBeInTheDocument();
    // The final step commits; it does not advance.
    expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
  });

  it("saves the agent from the review step", async () => {
    const { onSave } = renderDialog();
    goToReview();
    const displayedMention =
      screen.getByText("Mention").nextElementSibling?.textContent;

    fireEvent.click(screen.getByRole("button", { name: /Create agent/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // A mention copied from the review must be the exact executable identifier.
    expect(displayedMention).toBe(
      (onSave.mock.calls as unknown as Array<[{ mention: string }]>)[0][0]
        .mention,
    );
  });

  it("only enables Save & test once a test prompt is written", () => {
    renderDialog();
    goToReview();

    const saveTest = screen.getByRole("button", { name: "Save & test" });
    expect(saveTest).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Test prompt/), {
      target: { value: "list the open todos" },
    });
    expect(saveTest).not.toBeDisabled();
  });

  it("routes Save & test through the launch handler with the prompt", async () => {
    const { onSaveAndTest, onSave } = renderDialog();
    goToReview();

    fireEvent.change(screen.getByLabelText(/Test prompt/), {
      target: { value: "audit the auth flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & test" }));

    await waitFor(() => expect(onSaveAndTest).toHaveBeenCalledTimes(1));
    expect(onSaveAndTest.mock.calls[0][1]).toBe("audit the auth flow");
    // Save & test replaces plain save, not runs alongside it.
    expect(onSave).not.toHaveBeenCalled();
  });

  it("hides Save & test entirely when no launch handler is provided", () => {
    renderDialog({ onSaveAndTest: undefined });
    goToReview();
    expect(screen.queryByRole("button", { name: "Save & test" })).toBeNull();
  });
});

it("keeps a focused project bot skill pack unchanged when saving", async () => {
  globalThis.structuredClone ??= (value) => JSON.parse(JSON.stringify(value));
  const profile = createProjectBotProfile("lead", "focused-lead");
  profile.skillIds = ["concise-expert", "react-best-practices"];
  const { onSave } = renderDialog({ initialProfile: profile, minSkills: 0 });
  goToReview();
  fireEvent.click(screen.getByRole("button", { name: "Save agent" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(
    (onSave.mock.calls as unknown as Array<[{ skillIds: string[] }]>)[0][0]
      .skillIds,
  ).toEqual(profile.skillIds);
});
