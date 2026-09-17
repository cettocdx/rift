import { fireEvent, render, screen } from "@testing-library/react";
import { MemoizedMarkdown } from "../MemoizedMarkdown";
import { CodeHighlight } from "../CodeHighlight";

// Exercise the application's real block renderer and CodeHighlight lifecycle.
// Only the parser boundary is supplied here; the browser fixture covers the
// installed Streamdown parser's actual incomplete -> completed block sequence.
jest.mock("streamdown", () => ({
  defaultRemarkPlugins: {},
  Streamdown: ({ children, BlockComponent, isAnimating }: any) => (
    <BlockComponent content={children} isIncomplete={isAnimating} />
  ),
  Block: ({ content }: { content: string }) => (
    <CodeHighlight className="language-typescript">
      {content.replace(/^```typescript\n/, "").replace(/```\n?$/, "")}
    </CodeHighlight>
  ),
}));
jest.mock("@/app/contexts/GlobalState", () => ({ useGlobalState: () => ({}) }));
jest.mock("@/lib/utils/shiki", () => ({
  isLanguageSupported: (language: string) => language === "typescript",
  ShikiErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

const largeSource = Array.from(
  { length: 420 },
  (_, i) => `const line${i} = "${"long value ".repeat(12)}";\n`,
).join("");

it("retains wrapping and the reading anchor when a large streamed fence closes", () => {
  const open = "```typescript\n" + largeSource;
  const { container, rerender } = render(
    <MemoizedMarkdown content={open} revealWords />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Enable text wrapping" }));
  const pre = container.querySelector("pre")!;
  expect(pre).toHaveClass("whitespace-pre-wrap");
  rerender(<MemoizedMarkdown content={open + "```"} revealWords />);
  expect(
    screen.getByRole("button", { name: "Disable text wrapping" }),
  ).toBeInTheDocument();
  expect(container.querySelector("pre")).toBe(pre);
  expect(pre.textContent).toBe(largeSource);
  rerender(<MemoizedMarkdown content={open + "```"} />);
  expect(container.querySelector("pre")).toBe(pre);
});

it("retains wrapping while a small completed fence becomes highlighted", () => {
  const open = "```typescript\nconst ready = true;\n";
  const { rerender } = render(<MemoizedMarkdown content={open} revealWords />);
  fireEvent.click(screen.getByRole("button", { name: "Enable text wrapping" }));
  rerender(<MemoizedMarkdown content={open + "```"} revealWords />);
  expect(
    screen.getByRole("button", { name: "Disable text wrapping" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("shiki-code")).toHaveTextContent(
    "const ready = true;",
  );
});
