import { fireEvent, render, screen } from "@testing-library/react";
import { CodeHighlight } from "../CodeHighlight";

jest.mock("@/lib/utils/shiki", () => ({
  isLanguageSupported: (language: string) => language === "typescript",
  ShikiErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

const source = Array.from(
  { length: 1800 },
  (_, i) =>
    `export const item${i} = { name: "Synthetic item ${i}", enabled: true, value: ${i} };\n`,
).join("");
const block = (text: string) => (
  <CodeHighlight className="language-typescript">{text}</CodeHighlight>
);

it("keeps large code output complete without creating a token tree", () => {
  const { container, rerender } = render(block(source));
  expect(screen.queryByTestId("shiki-code")).not.toBeInTheDocument();
  const code = container.querySelector("pre code")!;
  expect(code.textContent).toBe(source);
  fireEvent.click(screen.getByRole("button", { name: "Enable text wrapping" }));
  expect(code.parentElement).toHaveClass("whitespace-pre-wrap");
  rerender(block(source + "// final update\n"));
  expect(container.querySelector("pre code")).toBe(code);
  expect(code.textContent).toBe(source + "// final update\n");
});

it("also bounds a single very long minified code line", () => {
  const { container } = render(
    block(`const payload = "${"x".repeat(100_000)}";`),
  );
  expect(screen.queryByTestId("shiki-code")).not.toBeInTheDocument();
  expect(
    container.querySelector("pre code")?.textContent?.length,
  ).toBeGreaterThan(100_000);
});

it("bounds token-node growth for many short lines below the character budget", () => {
  const { container } = render(block("const x = 1;\n".repeat(500)));
  expect(screen.queryByTestId("shiki-code")).not.toBeInTheDocument();
  expect(container.querySelector("pre code")?.textContent).toBe(
    "const x = 1;\n".repeat(500),
  );
});

it("restores highlighting when replaced with a small code sample", () => {
  const { rerender } = render(block(source));
  rerender(block("const ready = true;"));
  expect(screen.getByTestId("shiki-code")).toHaveTextContent(
    "const ready = true;",
  );
});

it("copies the full large source rather than a display excerpt", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(block(source));
  fireEvent.click(screen.getByRole("button", { name: "Copy", exact: true }));
  await screen.findByRole("button", { name: "Copied!" });
  expect(writeText).toHaveBeenCalledWith(source);
});

it("shows the complete streaming source immediately and highlights only after the fence closes", () => {
  const code = "const ready = true;";
  const { container, rerender } = render(
    <CodeHighlight className="language-typescript" isStreaming>
      {code}
    </CodeHighlight>,
  );
  expect(screen.queryByTestId("shiki-code")).not.toBeInTheDocument();
  expect(container.querySelector("pre code")?.textContent).toBe(code);
  rerender(
    <CodeHighlight className="language-typescript" isStreaming={false}>
      {code}
    </CodeHighlight>,
  );
  expect(screen.getByTestId("shiki-code")).toHaveTextContent(code);
});
