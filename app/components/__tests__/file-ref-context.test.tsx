import { render, screen, fireEvent } from "@testing-library/react";
import type { Element } from "react-shiki";
import { FileRefProvider } from "../file-ref-context";
import { FileAwareCode } from "../MemoizedMarkdown";
import type { SidebarContent } from "@/types/chat";

const mockOpenSidebar = jest.fn();
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({ openSidebar: mockOpenSidebar }),
}));
// The repo's react-shiki mock hard-codes isInlineCode() => false; these tests
// are ABOUT the inline branch, so give the real signal shape back.
jest.mock("react-shiki", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => (
    <code>{children}</code>
  ),
  isInlineCode: (node: { inline?: boolean }) => node?.inline === true,
}));

const inlineNode = { inline: true } as unknown as Element;

const exec = {
  type: "file",
  path: "/root/app/AGENTS.md",
  action: "editing",
  originalContent: "a\n",
  content: "a\nb\n",
} as unknown as SidebarContent;

const renderSpan = (text: string) =>
  render(
    <FileRefProvider toolExecutions={[exec]}>
      <FileAwareCode node={inlineNode}>{text}</FileAwareCode>
    </FileRefProvider>,
  );

describe("file references in prose", () => {
  beforeEach(() => mockOpenSidebar.mockClear());

  it("paints a changed file's name blue and opens its diff", () => {
    renderSpan("AGENTS.md");
    const ref = screen.getByRole("button", { name: "AGENTS.md" });
    expect(ref).toHaveAttribute("data-ui", "file-ref");
    expect(ref).toHaveAttribute("title", "/root/app/AGENTS.md");
    fireEvent.click(ref);
    expect(mockOpenSidebar).toHaveBeenCalledWith(exec);
  });

  it("resolves the full path too", () => {
    renderSpan("/root/app/AGENTS.md");
    expect(
      screen.getByRole("button", { name: "/root/app/AGENTS.md" }),
    ).toBeInTheDocument();
  });

  it("leaves a span that resolves to nothing as ordinary code", () => {
    // Painting it blue would be a promise the click cannot keep.
    renderSpan("npm test");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
