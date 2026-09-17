import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  PlanQuestions,
  parsePlanQuestions,
  type PlanQuestionsData,
} from "../PlanQuestions";
import { submitChatMessage } from "@/lib/utils/submit-message";

jest.mock("@/lib/utils/submit-message", () => ({
  submitChatMessage: jest.fn().mockResolvedValue(true),
}));

const QUESTIONS: PlanQuestionsData = {
  questions: [
    {
      id: "database",
      question: "Which database should back the product?",
      options: [
        {
          label: "Postgres",
          detail: "Relational data and strong querying",
          recommended: true,
        },
        { label: "SQLite", detail: "A compact local-first option" },
      ],
    },
    {
      id: "audience",
      question: "Who is the primary audience?",
      options: [{ label: "Product teams" }, { label: "Developers" }],
    },
  ],
};

describe("PlanQuestions", () => {
  beforeEach(() => jest.mocked(submitChatMessage).mockClear());

  it("keeps Send disabled until every question has an answer", async () => {
    render(<PlanQuestions data={QUESTIONS} />);
    const submit = screen.getByRole("button", { name: /Send/i });

    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Postgres/i }));
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Product teams/i }));
    expect(submit).toBeEnabled();
  });

  it("supports a professional custom-answer path", async () => {
    render(<PlanQuestions data={QUESTIONS} />);

    fireEvent.click(screen.getByRole("radio", { name: /Postgres/i }));
    fireEvent.change(
      screen.getByRole("textbox", {
        name: /Custom answer: Who is the primary audience/i,
      }),
      { target: { value: "Independent design studios" } },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    });

    expect(submitChatMessage).toHaveBeenCalledWith(
      expect.stringContaining("Custom answer: Independent design studios"),
    );
  });

  it("rejects malformed question payloads", async () => {
    expect(parsePlanQuestions("not json")).toBeNull();
    expect(parsePlanQuestions('{"questions":[]}')).toBeNull();
  });
});

it("selects without sending and submits only once", async () => {
  jest.mocked(submitChatMessage).mockClear();
  render(<PlanQuestions data={{ questions: [QUESTIONS.questions[0]] }} />);
  fireEvent.click(screen.getByRole("radio", { name: /Postgres/i }));
  expect(submitChatMessage).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  });
  await screen.findByRole("button", { name: /^Sent$/ });
  fireEvent.click(screen.getByRole("button", { name: /^Sent$/ }));
  expect(submitChatMessage).toHaveBeenCalledTimes(1);
});
it("collapses without sending and restores the selected answer", async () => {
  jest.mocked(submitChatMessage).mockClear();
  render(<PlanQuestions data={{ questions: [QUESTIONS.questions[0]] }} />);
  fireEvent.click(screen.getByRole("radio", { name: /SQLite/i }));
  fireEvent.click(screen.getByRole("button", { name: "Collapse question" }));
  expect(submitChatMessage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Show question" }));
  expect(screen.getByRole("radio", { name: /SQLite/i })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
it("supports radio arrow keys and keeps free text independent of shortcuts", async () => {
  render(<PlanQuestions data={{ questions: [QUESTIONS.questions[0]] }} />);
  fireEvent.keyDown(screen.getByRole("radio", { name: /Postgres/i }), {
    key: "ArrowDown",
  });
  expect(screen.getByRole("radio", { name: /SQLite/i })).toHaveFocus();
  expect(screen.getByRole("radio", { name: /SQLite/i })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
it("never treats skip as consent", async () => {
  jest.mocked(submitChatMessage).mockClear();
  render(<PlanQuestions data={QUESTIONS} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  });
  expect(submitChatMessage).toHaveBeenCalledWith(
    expect.stringContaining("Do not treat this as approval"),
  );
});
it("makes historical questions read-only", async () => {
  render(<PlanQuestions data={QUESTIONS} readOnly />);
  fireEvent.click(screen.getByRole("button", { name: "Show question" }));
  expect(screen.getByRole("radio", { name: /Postgres/i })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: /^Send$/ }),
  ).not.toBeInTheDocument();
});

it("restores a saved custom answer on focus without losing the draft", async () => {
  jest.mocked(submitChatMessage).mockClear();
  render(<PlanQuestions data={{ questions: [QUESTIONS.questions[0]] }} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "My own database" } });
  fireEvent.click(screen.getByRole("radio", { name: /Postgres/i }));
  fireEvent.focus(input);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  });
  expect(submitChatMessage).toHaveBeenCalledWith(
    expect.stringContaining("Custom answer: My own database"),
  );
});
it("preserves multiple selections with a custom answer", async () => {
  jest.mocked(submitChatMessage).mockClear();
  render(
    <PlanQuestions
      data={{ questions: [{ ...QUESTIONS.questions[0], multi: true }] }}
    />,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /Postgres/i }));
  fireEvent.click(screen.getByRole("checkbox", { name: /SQLite/i }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Also Redis" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  });
  expect(submitChatMessage).toHaveBeenCalledWith(
    expect.stringContaining("Postgres, SQLite, Custom answer: Also Redis"),
  );
});

it("keeps choices editable after rejection and locks only after acceptance", async () => {
  let settle!: (value: boolean) => void;
  jest.mocked(submitChatMessage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  render(<PlanQuestions data={{ questions: [QUESTIONS.questions[0]] }} />);
  fireEvent.click(screen.getByRole("radio", { name: /SQLite/i }));
  fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
  expect(screen.queryByText("Answer sent")).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /SQLite/i })).toBeDisabled();
  await act(async () => settle(false));
  expect(screen.getByRole("alert")).toHaveTextContent("not confirmed");
  expect(screen.getByRole("radio", { name: /SQLite/i })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(screen.getByRole("button", { name: /^Send$/ })).toBeEnabled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  });
  expect(screen.getByText("Answer sent")).toBeInTheDocument();
});
