import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { BuildPreviewPanel } from "../BuildPreviewPanel";

const url = "https://preview.example/project?view=mobile";
let mockPreviewUrl = url;
jest.mock("../../contexts/GlobalState", () => ({
  useGlobalState: () => ({
    buildPreviewUrl: mockPreviewUrl,
    setBuildPreviewOpen: jest.fn(),
  }),
}));
jest.mock("../../hooks/useBuildPreviewHealth", () => ({
  useBuildPreviewHealth: () => ({ status: "running", url: mockPreviewUrl }),
}));
jest.mock("../workbench/WorkbenchBrowser", () => ({
  WorkbenchBrowser: ({ toolbar }: { toolbar: React.ReactNode }) => (
    <>
      {toolbar}
      <iframe title="App preview" />
    </>
  ),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
beforeEach(() => {
  jest.clearAllMocks();
  mockPreviewUrl = url;
});
afterEach(() => {
  if (originalClipboard)
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});
const clipboard = (value: unknown) =>
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });

describe.each([false, true])("preview copy (embedded=%s)", (embedded) => {
  it.each(["missing", "denied"])(
    "offers a selectable exact link when clipboard is %s without reloading the preview",
    async (mode) => {
      clipboard(
        mode === "missing"
          ? undefined
          : {
              writeText: jest
                .fn()
                .mockRejectedValue(
                  new DOMException("Denied", "NotAllowedError"),
                ),
            },
      );
      render(<BuildPreviewPanel chatId="chat" embedded={embedded} />);
      const frame = screen.getByTitle("App preview");
      fireEvent.click(
        screen.getByRole("button", { name: "Copy preview link" }),
      );
      const fallback = await screen.findByRole("textbox", {
        name: "Preview link",
      });
      expect(fallback).toHaveValue(url);
      expect(fallback).toHaveAttribute("readonly");
      expect(screen.getByTitle("App preview")).toBe(frame);
      expect(toast.success).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss copy link" }),
      );
      expect(
        screen.queryByRole("textbox", { name: "Preview link" }),
      ).not.toBeInTheDocument();
    },
  );

  it("announces copying only after the browser confirms it", async () => {
    let finish!: () => void;
    const writeText = jest.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    clipboard({ writeText });
    render(<BuildPreviewPanel chatId="chat" embedded={embedded} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy preview link" }));
    expect(toast.success).not.toHaveBeenCalled();
    finish();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Preview link copied"),
    );
    expect(writeText).toHaveBeenCalledWith(url);
    expect(
      screen.queryByRole("textbox", { name: "Preview link" }),
    ).not.toBeInTheDocument();
  });
});

it.each([url, "https://other.example"])(
  "does not show a late denial in another chat even when its URL is %s",
  async (nextUrl) => {
    let reject!: (error: Error) => void;
    clipboard({
      writeText: () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    });
    const view = render(<BuildPreviewPanel chatId="chat-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy preview link" }));
    mockPreviewUrl = nextUrl;
    view.rerender(<BuildPreviewPanel chatId="chat-b" />);
    await act(async () => reject(new Error("Denied")));
    expect(
      screen.queryByRole("textbox", { name: "Preview link" }),
    ).not.toBeInTheDocument();
  },
);
