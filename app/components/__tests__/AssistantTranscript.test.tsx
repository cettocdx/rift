import { fireEvent, render, screen } from "@testing-library/react";
import {
  AssistantTranscript,
  transcriptSegments,
  toolGroupSummary,
  type TranscriptPart,
} from "../AssistantTranscript";

const parts: TranscriptPart[] = [
  { type: "text", text: "I will check the files." },
  { type: "tool-shell", state: "output-available", input: { command: "ls" } },
  { type: "data-terminal" },
  { type: "tool-read_file", state: "input-available" },
  { type: "text", text: "The change is ready." },
];
const renderPart = (index: number) => (
  <p data-testid={`detail-${index}`}>
    {parts[index].text ?? `Evidence ${index}`}
  </p>
);

describe("Assistant transcript", () => {
  it("keeps commentary and final prose in place while work is collapsed", () => {
    const { rerender } = render(
      <AssistantTranscript
        parts={parts}
        status="streaming"
        renderPart={renderPart}
      />,
    );
    const commentary = screen.getByText("I will check the files.");
    expect(screen.getByText("The change is ready.")).toBeVisible();
    expect(screen.queryByText("Evidence 1")).not.toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: /Reading files/,
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(screen.getByText("Evidence 1")).toBeVisible();
    expect(screen.getByText("Evidence 3")).toBeVisible();
    rerender(
      <AssistantTranscript
        parts={parts.map((p) =>
          p.state === "input-available"
            ? { ...p, state: "output-available" }
            : p,
        )}
        status="ready"
        renderPart={renderPart}
      />,
    );
    expect(screen.getByText("I will check the files.")).toBe(commentary);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Evidence 1")).toBeVisible();
  });

  it("keeps original part indexes and does not hide questions or preview results", () => {
    expect(
      transcriptSegments([
        { type: "file" },
        { type: "reasoning", text: "Public reasoning" },
        { type: "tool-shell", state: "approval-requested" },
        { type: "tool-expose_preview" },
        { type: "tool-get_terminal_files" },
        { type: "tool-ask_question" },
        { type: "data-agent-heartbeat" },
        { type: "text", text: "Choose a size." },
      ]),
    ).toEqual(
      [1, 2, 3, 4, 5, 7].map((index) => ({ kind: "part", indexes: [index] })),
    );
  });

  it("never shows stopped or failed operations as still running", () => {
    expect(
      toolGroupSummary(
        [{ type: "tool-shell", state: "input-available" }],
        "ready",
      ).detail,
    ).toBe("interrupted");
    expect(
      toolGroupSummary(
        [
          {
            type: "tool-shell",
            state: "output-available",
            output: { exitCode: 1 },
          },
        ],
        "ready",
      ).detail,
    ).toBe("1 failed");
  });
});

it("labels a pending operation as awaiting approval instead of running", () => {
  expect(
    toolGroupSummary(
      [{ type: "tool-run_terminal_cmd", state: "input-available" }],
      "streaming",
      true,
    ).detail,
  ).toBe("awaiting approval");
});

it("distinguishes rejected permission from a command that ran and failed", () => {
  const result = toolGroupSummary(
    [
      {
        type: "tool-run_terminal_cmd",
        state: "output-error",
        errorText:
          "Action denied. Do not retry it without a new user instruction.",
      },
    ],
    "ready",
  );
  expect(result.detail).toBe("1 not approved");
  expect(result.failed).toBe(0);
});

it("keeps named agent updates separate from file work and opens the Activity list for legacy ids", () => {
  const work: TranscriptPart[] = [
    {
      type: "tool-read_file",
      input: { path: "Sidebar.tsx" },
      state: "output-available",
    },
    {
      type: "tool-delegate_task",
      input: { agentName: "UI review" },
      state: "output-available",
      output: { agent: { name: "UI review", status: "completed" } },
    },
    {
      type: "tool-desktop_workspace_write",
      input: { relativePath: "Sidebar.tsx" },
      state: "output-available",
      output: { ok: true },
    },
  ];
  render(
    <AssistantTranscript
      parts={work}
      status="ready"
      renderPart={(index) => <p>Details {index}</p>}
    />,
  );
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(
    screen.getByRole("button", { name: "Read Sidebar.tsx" }),
  ).toBeVisible();
  const agent = screen.getByRole("button", { name: "UI review updated" });
  expect(agent.querySelector('[data-ui="agent-activity-mark"]')).not.toBeNull();
  const listener = jest.fn();
  window.addEventListener("rift:open-agent-activity", listener);
  fireEvent.click(agent);
  window.removeEventListener("rift:open-agent-activity", listener);
  expect(listener.mock.calls[0][0].detail).toEqual({});
  expect(screen.queryByText("Details 1")).not.toBeInTheDocument();
  expect(screen.queryByText("Details 0")).not.toBeInTheDocument();
});

it("does not conceal a failed operation while the next operation is running", () => {
  render(
    <AssistantTranscript
      parts={[
        {
          type: "tool-read_file",
          state: "output-available",
          output: { error: "Missing file" },
        },
        { type: "tool-shell", state: "input-available" },
      ]}
      status="streaming"
      renderPart={() => null}
    />,
  );
  expect(screen.getByRole("button")).toHaveTextContent("1 failed");
});

it("opens the first delegated invocation in Activity without an empty inline disclosure", () => {
  const listener = jest.fn();
  window.addEventListener("rift:open-agent-activity", listener);
  try {
    const renderDetail = jest.fn(() => <p>Inline detail</p>);
    render(
      <AssistantTranscript
        status="streaming"
        renderPart={renderDetail}
        parts={[
          {
            type: "tool-delegate_task",
            toolCallId: "first-delegate",
            state: "input-available",
            input: { agentId: "quality" },
          },
          {
            type: "tool-delegate_task",
            toolCallId: "second-delegate",
            state: "input-available",
            input: { agentId: "research" },
          },
        ]}
      />,
    );
    const agent = screen.getByRole("button");
    fireEvent.click(agent);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({
      toolCallId: "first-delegate",
    });
    expect(agent).not.toHaveAttribute("aria-expanded");
    expect(renderDetail).not.toHaveBeenCalled();
    expect(screen.queryByText("Inline detail")).not.toBeInTheDocument();
  } finally {
    window.removeEventListener("rift:open-agent-activity", listener);
  }
});

it("folds interleaved completed reasoning into observed work without losing its details", () => {
  const work: TranscriptPart[] = [
    { type: "reasoning", text: "Inspect the sources", state: "done" },
    {
      type: "tool-read_file",
      state: "output-available",
      input: { path: "app.ts" },
    },
    { type: "step-start" },
    { type: "reasoning", text: "Run the check", state: "done" },
    {
      type: "tool-run_terminal_cmd",
      state: "output-available",
      output: { exitCode: 0 },
    },
    { type: "text", text: "The check passed." },
  ];
  const renderDetail = (index: number) => (
    <p>{work[index].text ?? `Operation ${index}`}</p>
  );
  render(
    <AssistantTranscript
      parts={work}
      status="ready"
      renderPart={renderDetail}
    />,
  );
  expect(screen.queryByText("Inspect the sources")).not.toBeInTheDocument();
  expect(screen.queryByText("Run the check")).not.toBeInTheDocument();
  expect(screen.getByText("The check passed.")).toBeVisible();
  const row = screen.getByRole("button", {
    name: "Read app.ts, ran a command",
  });
  fireEvent.click(row);
  expect(screen.getByText("Inspect the sources")).toBeVisible();
  expect(screen.getByText("Run the check")).toBeVisible();
  expect(screen.getByText("Operation 1")).toBeVisible();
  expect(screen.getByText("Operation 4")).toBeVisible();
});

it("keeps the current thinking phase visible and the work row mounted as more tools arrive", () => {
  const work: TranscriptPart[] = [
    { type: "reasoning", text: "First thought", state: "done" },
    { type: "tool-read_file", state: "output-available" },
    { type: "reasoning", text: "Thinking now", state: "streaming" },
  ];
  const renderDetail = (index: number) => (
    <p>{work[index]?.text ?? `Detail ${index}`}</p>
  );
  const { rerender } = render(
    <AssistantTranscript
      parts={work}
      status="streaming"
      renderPart={renderDetail}
    />,
  );
  expect(screen.getByText("Thinking now")).toBeVisible();
  const row = screen.getByRole("button", { name: "Read files" });
  fireEvent.click(row);
  rerender(
    <AssistantTranscript
      parts={[
        ...work,
        { type: "tool-run_terminal_cmd", state: "input-available" },
      ]}
      status="streaming"
      renderPart={renderDetail}
    />,
  );
  expect(screen.getByRole("button", { name: "Running a command" })).toBe(row);
  expect(row).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Thinking now")).toBeVisible();
});

it("never folds reasoning across commentary, approval or agent activity boundaries", () => {
  const work: TranscriptPart[] = [
    { type: "reasoning", text: "Explain" },
    { type: "text", text: "Please confirm." },
    { type: "reasoning", text: "Waiting" },
    { type: "tool-shell", state: "approval-requested" },
    { type: "reasoning", text: "Delegate" },
    { type: "tool-delegate_task", state: "input-available" },
    { type: "reasoning", text: "Still thinking" },
  ];
  expect(transcriptSegments(work)).toEqual(
    work.map((_, index) => ({
      kind: index === 5 ? "tools" : "part",
      indexes: [index],
    })),
  );
});

it("keeps a generated image mounted when later prose streams in and finishes", () => {
  const initial: TranscriptPart[] = [
    { type: "text", text: "Creating the image" },
    {
      type: "tool-generate_image",
      toolCallId: "image-1",
      state: "output-available",
    },
  ];
  const renderEntry = (index: number) => (
    <div data-testid={`ordered-${index}`}>{index}</div>
  );
  const { rerender, container } = render(
    <AssistantTranscript
      parts={initial}
      status="streaming"
      renderPart={renderEntry}
    />,
  );
  const image = screen.getByTestId("ordered-1");
  const extended = [
    ...initial,
    { type: "text", text: "Explanation after the image" },
  ];
  rerender(
    <AssistantTranscript
      parts={extended}
      status="streaming"
      renderPart={renderEntry}
    />,
  );
  expect(screen.getByTestId("ordered-1")).toBe(image);
  rerender(
    <AssistantTranscript
      parts={extended}
      status="ready"
      renderPart={renderEntry}
    />,
  );
  expect(screen.getByTestId("ordered-1")).toBe(image);
  expect(
    Array.from(container.querySelectorAll('[data-testid^="ordered-"]')).map(
      (node) => node.textContent,
    ),
  ).toEqual(["0", "1", "2"]);
});

it("keeps desktop consent and denied screenshots visible outside collapsed work", () => {
  expect(
    transcriptSegments([
      { type: "tool-shell", state: "output-available" },
      { type: "tool-desktop_access_status", state: "output-available" },
      {
        type: "tool-desktop_screenshot",
        state: "output-available",
        output: { ok: false, code: "denied" },
      },
      { type: "tool-shell", state: "output-available" },
    ]),
  ).toEqual([
    { kind: "tools", indexes: [0] },
    { kind: "part", indexes: [1] },
    { kind: "part", indexes: [2] },
    { kind: "tools", indexes: [3] },
  ]);
});
