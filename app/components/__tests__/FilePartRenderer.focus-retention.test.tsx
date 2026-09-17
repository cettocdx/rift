import { act, fireEvent, render, screen } from "@testing-library/react";
import { FilePartRenderer } from "../FilePartRenderer";
import type { FilePart } from "@/types/file";

const mockAction = jest.fn();
const mockConvex = { query: jest.fn() };
jest.mock("convex/react", () => ({
  useAction: () => mockAction,
  useConvex: () => mockConvex,
}));
jest.mock("../../contexts/FileUrlCacheContext", () => ({
  useFileUrlCacheContext: () => null,
}));
jest.mock("@/lib/utils/file-download", () => ({ downloadFromUrl: jest.fn() }));

it("keeps the image opener mounted during canonical URL resolution and restores focus after closing", async () => {
  let finish!: (url: string) => void;
  mockAction.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  render(
    <FilePartRenderer
      part={{
        fileId: "image-one" as FilePart["fileId"],
        url: "/preview.png",
        mediaType: "image/png",
        name: "Landscape",
      }}
      partIndex={0}
      messageId="answer"
    />,
  );
  const opener = screen.getByRole("button", {
    name: "View Landscape in full size",
  });
  fireEvent.click(opener);
  expect(screen.getByRole("dialog")).toHaveFocus();
  await act(async () => finish("/canonical.png"));
  expect(opener.isConnected).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close image viewer" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
