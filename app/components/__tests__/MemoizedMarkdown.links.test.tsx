import { fireEvent, render, screen } from "@testing-library/react";
import { MemoizedMarkdown } from "../MemoizedMarkdown";
import { revealFileInDir } from "@/app/hooks/useTauri";

// Exercise the actual app link renderer with parser-produced href values.
jest.mock("streamdown", () => ({
  defaultRemarkPlugins: {},
  Streamdown: ({ children, components }: any) => {
    const Link = components.a;
    return <Link href={children}>Working file</Link>;
  },
}));
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => true,
  revealFileInDir: jest.fn(),
}));
jest.mock("@/app/contexts/GlobalState", () => ({ useGlobalState: () => ({}) }));

beforeEach(() => jest.clearAllMocks());

it.each([
  "/tmp/report%",
  "/tmp/report%2",
  "/tmp/report%zz.md",
  "/tmp/progress100%.txt",
])(
  "keeps the conversation available with an incomplete or literal path escape: %s",
  (path) => {
    const { rerender } = render(
      <MemoizedMarkdown content={path} revealWords />,
    );
    const link = screen.getByRole("button", { name: "Working file" });
    fireEvent.click(link);
    expect(revealFileInDir).toHaveBeenCalledWith(path);
    rerender(<MemoizedMarkdown content="/tmp/report%20final.md" revealWords />);
    expect(screen.getByRole("button", { name: "Working file" })).toBe(link);
    fireEvent.click(link);
    expect(revealFileInDir).toHaveBeenLastCalledWith("/tmp/report final.md");
  },
);

it("decodes an encoded local path exactly once", () => {
  render(<MemoizedMarkdown content="/tmp/report%2520.md" />);
  fireEvent.click(screen.getByRole("button", { name: "Working file" }));
  expect(revealFileInDir).toHaveBeenCalledWith("/tmp/report%20.md");
});
