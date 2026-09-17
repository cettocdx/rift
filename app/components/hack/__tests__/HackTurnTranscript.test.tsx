import { fireEvent, render, screen } from "@testing-library/react";
import { HackTurnTranscript } from "../HackTurnTranscript";
import type { HackTranscriptItem } from "@/lib/hack/transcript-presentation";
jest.mock("../../MemoizedMarkdown", () => ({
  MemoizedMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));
jest.mock("../../FilePartRenderer", () => ({
  FilePartRenderer: () => <span>Attached file</span>,
}));
const tool: HackTranscriptItem = {
  kind: "tool",
  name: "run_terminal_cmd",
  cmd: "node check.mjs",
  out: "PASS\nlarge raw output",
  streamOut: "",
  state: "output-available",
  output: { exitCode: 0 },
};
const items: HackTranscriptItem[] = [
  { kind: "line", cls: "o", text: "I will check the files." },
  { kind: "reason", text: "Inspect first." },
  tool,
  { kind: "line", cls: "o", text: "The check passed." },
];
it("keeps command evidence collapsed and presents only the trailing answer as the result", () => {
  render(<HackTurnTranscript items={items} running={false} messageId="test" />);
  expect(
    screen.getByRole("region", { name: "Final response" }),
  ).toHaveTextContent("The check passed.");
  expect(screen.getByText("I will check the files.")).toBeVisible();
  expect(screen.queryByText(/large raw output/)).not.toBeInTheDocument();
  expect(screen.getByText("I will check the files.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Ran a command/ }));
  expect(screen.getByText(/large raw output/)).toBeVisible();
});
it("does not promote commentary before a tool call into a final answer", () => {
  render(
    <HackTurnTranscript
      items={items.slice(0, 3)}
      running={false}
      messageId="test"
    />,
  );
  expect(
    screen.queryByRole("region", { name: "Final response" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/without a final response/)).toBeVisible();
});
it("keeps tool disclosure closed during streaming and preserves it through completion", () => {
  const { rerender } = render(
    <HackTurnTranscript
      items={[
        items[0],
        { ...tool, state: "input-available", out: "", output: undefined },
      ]}
      running
      messageId="test"
    />,
  );
  expect(
    screen.queryByRole("region", { name: "Final response" }),
  ).not.toBeInTheDocument();
  const log = screen.getByRole("button", { name: /Work log/ });
  expect(log).toHaveAttribute("aria-expanded", "true");
  rerender(
    <HackTurnTranscript items={items} running={false} messageId="test" />,
  );
  expect(screen.getByRole("button", { name: /Work log/ })).toBe(log);
  expect(log).toHaveAttribute("aria-expanded", "true");
  expect(screen.queryByText(/large raw output/)).not.toBeInTheDocument();
});
it("shows command failure without manufacturing a successful final result", () => {
  render(
    <HackTurnTranscript
      items={[{ ...tool, output: { exitCode: 1 } }]}
      running={false}
      messageId="test"
    />,
  );
  expect(screen.getByText("1 failed")).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Final response" }),
  ).not.toBeInTheDocument();
});

it("keeps generated files visible outside the collapsed work log", () => {
  render(
    <HackTurnTranscript
      items={[...items, { kind: "file", part: { name: "report.txt" } }]}
      running={false}
      messageId="test"
    />,
  );
  expect(screen.getByText("Attached file")).toBeVisible();
  expect(screen.getByRole("button", { name: /Work log/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});
it("labels an interrupted answer honestly and hides completed-report actions", () => {
  render(
    <HackTurnTranscript
      items={items}
      running={false}
      interrupted
      messageId="test"
      actions={<button>Open report</button>}
    />,
  );
  expect(
    screen.getByRole("region", { name: "Partial response" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Open report" }),
  ).not.toBeInTheDocument();
});
it("redacts command credentials while retaining readable literal output", () => {
  render(
    <HackTurnTranscript
      items={[
        {
          ...tool,
          cmd: "curl --token secret-value https://example.com",
          out: "\u001b[32mPASS\u001b[0m",
        },
      ]}
      running={false}
      messageId="test"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Ran a command/ }));
  expect(screen.queryByText(/secret-value/)).not.toBeInTheDocument();
  expect(screen.getByText(/--token \[redacted\]/)).toBeVisible();
  expect(screen.getByLabelText("Tool output").textContent).toBe("PASS");
});

it("retains visible reasoning and earlier updates as later tools and answers arrive", () => {
  const { rerender } = render(
    <HackTurnTranscript items={items.slice(0, 2)} running messageId="stable" />,
  );
  expect(screen.getByText("Inspect first.")).toBeVisible();
  rerender(<HackTurnTranscript items={items} running messageId="stable" />);
  expect(screen.getByText("Inspect first.")).toBeVisible();
  expect(screen.getByText("I will check the files.")).toBeVisible();
  rerender(
    <HackTurnTranscript items={items} running={false} messageId="stable" />,
  );
  expect(screen.getByText("Inspect first.")).toBeVisible();
  expect(screen.getByText("I will check the files.")).toBeVisible();
});
