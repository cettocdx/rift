import { createContext, useContext, useState, type ReactNode } from "react";
import { act, render } from "@testing-library/react";
import { CodeHighlight } from "../CodeHighlight";

let mockTheme = "light";
const mockThemeContext = createContext("light");
jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: useContext(mockThemeContext) }),
}));

const mockHighlight = jest.fn((..._args: unknown[]): React.ReactNode => null);
jest.mock("react-shiki", () => ({
  __esModule: true,
  default: () => null,
  useShikiHighlighter: (...args: unknown[]) => mockHighlight(...args),
  isInlineCode: () => false,
}));
jest.mock("@/lib/utils/shiki", () => ({
  isLanguageSupported: (language: string) =>
    ["typescript", "javascript"].includes(language),
  ShikiErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  mockTheme = "light";
  mockHighlight.mockReset().mockReturnValue(null);
});

it("keeps all source visible while the syntax highlighter has no result", () => {
  const source = "const ready = true;\n".repeat(80);
  const { container } = render(
    <CodeHighlight className="language-typescript">{source}</CodeHighlight>,
  );
  expect(container.querySelector("pre code")?.textContent).toBe(source);
});

it("does not start syntax work for streaming or oversized source", () => {
  const { rerender } = render(
    <CodeHighlight className="language-typescript" isStreaming>
      const value=1;
    </CodeHighlight>,
  );
  expect(mockHighlight).not.toHaveBeenCalled();
  rerender(
    <CodeHighlight className="language-typescript">
      {"const value=1;\n".repeat(500)}
    </CodeHighlight>,
  );
  expect(mockHighlight).not.toHaveBeenCalled();
});

it.each(["source", "language", "theme"])(
  "does not display a stale result after %s changes or a late old completion",
  (change) => {
    const resolve = new Map<string, (node: ReactNode) => void>();
    mockHighlight.mockImplementation(
      function useDeferredHighlight(code, language, theme) {
        const [result, setResult] = useState<ReactNode>(null);
        const key = JSON.stringify([code, language, theme]);
        resolve.set(key, setResult);
        return result;
      },
    );
    const sourceA = "const original = true;";
    const { container, rerender } = render(
      <mockThemeContext.Provider value={mockTheme}>
        <CodeHighlight className="language-typescript">{sourceA}</CodeHighlight>
      </mockThemeContext.Provider>,
    );
    const finishA = [...resolve.values()][0];
    const highlighted = (source: string) => (
      <pre>
        <code>
          <span data-testid="resolved-highlight">{source}</span>
        </code>
      </pre>
    );
    act(() => finishA(highlighted(sourceA)));
    expect(
      container.querySelector('[data-testid="resolved-highlight"]'),
    ).not.toBeNull();

    const sourceB = change === "source" ? "const replacement = true;" : sourceA;
    const language = change === "language" ? "javascript" : "typescript";
    if (change === "theme") mockTheme = "dark";
    rerender(
      <mockThemeContext.Provider value={mockTheme}>
        <CodeHighlight className={`language-${language}`}>
          {sourceB}
        </CodeHighlight>
      </mockThemeContext.Provider>,
    );
    expect(container.querySelector("pre code")?.textContent).toBe(sourceB);
    expect(
      container.querySelector('[data-testid="resolved-highlight"]'),
    ).toBeNull();
    act(() => finishA(highlighted("outdated late result")));
    expect(container.querySelector("pre code")?.textContent).toBe(sourceB);
    expect(
      container.querySelector('[data-testid="resolved-highlight"]'),
    ).toBeNull();

    const finishB = [...resolve.values()].at(-1)!;
    act(() => finishB(highlighted(sourceB)));
    expect(
      container.querySelector('[data-testid="resolved-highlight"]')
        ?.textContent,
    ).toBe(sourceB);
  },
);
