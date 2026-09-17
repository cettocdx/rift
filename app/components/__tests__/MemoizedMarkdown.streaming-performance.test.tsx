import { render } from "@testing-library/react";
import { MemoizedMarkdown } from "../MemoizedMarkdown";
import * as fences from "@/lib/ui/streaming-code-fence";

const mockStreamdown = jest.fn((_props: any): React.ReactNode => null);
jest.mock("@/lib/ui/streaming-code-fence", () => ({
  standaloneCodeFence: jest.fn(
    jest.requireActual("@/lib/ui/streaming-code-fence").standaloneCodeFence,
  ),
}));
jest.mock("streamdown", () => ({
  defaultRemarkPlugins: {},
  Streamdown: (props: unknown) => mockStreamdown(props),
  Block: ({ content }: { content: string }) => <p>{content}</p>,
}));
jest.mock("@/app/contexts/GlobalState", () => ({ useGlobalState: () => ({}) }));

beforeEach(() => mockStreamdown.mockReset());
afterEach(() => jest.restoreAllMocks());

it("skips unchanged block classification while updating changed content and stream state", () => {
  const classify = jest.mocked(fences.standaloneCodeFence);
  mockStreamdown.mockImplementation(
    ({ children, BlockComponent, isAnimating, components }) =>
      children
        .split("\n\n")
        .map((content: string, index: number) => (
          <BlockComponent
            key={index}
            index={index}
            content={content}
            components={components}
            isIncomplete={isAnimating && index === 1}
          />
        )),
  );
  const { rerender, getByText } = render(
    <MemoizedMarkdown content={"Completed\n\nLive"} revealWords />,
  );
  classify.mockClear();
  rerender(
    <MemoizedMarkdown content={"Completed\n\nLive update"} revealWords />,
  );
  expect(classify.mock.calls.map(([content]) => content)).toEqual([
    "Live update",
  ]);
  expect(getByText("Live update")).toBeInTheDocument();
  classify.mockClear();
  rerender(<MemoizedMarkdown content={"Completed\n\nLive update"} />);
  expect(classify.mock.calls.map(([content]) => content)).toEqual([
    "Live update",
  ]);
  classify.mockClear();
  rerender(<MemoizedMarkdown content={"Corrected\n\nLive update"} />);
  expect(classify.mock.calls.map(([content]) => content)).toEqual([
    "Corrected",
  ]);
  expect(getByText("Corrected")).toBeInTheDocument();
});

it("skips redundant link repair in a long, complete transcript", () => {
  const content = Array.from(
    { length: 200 },
    (_, i) => `[file ${i}](https://example.com/${i})`,
  ).join("\n\n");
  const { rerender } = render(
    <MemoizedMarkdown content={content} revealWords />,
  );
  expect(mockStreamdown.mock.lastCall?.[0]).toMatchObject({
    remend: { links: false, images: false },
  });
  rerender(
    <MemoizedMarkdown content={content + "\n\n[unfinished"} revealWords />,
  );
  expect(mockStreamdown.mock.lastCall?.[0]).toMatchObject({
    remend: undefined,
  });
});

it.each([
  "[unfinished",
  "[text](https://exa",
  "![image](https://exa",
  "[a [nested]",
  "[label <tag]",
  "[escaped\\]",
  "[x](url[unfinished)",
])("retains the original repair for uncertain syntax: %s", (content) => {
  render(<MemoizedMarkdown content={content} revealWords />);
  expect(mockStreamdown.mock.lastCall?.[0]).not.toMatchObject({
    remend: { links: false },
  });
});
