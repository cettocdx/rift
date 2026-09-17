import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageViewer } from "../ImageViewer";
import { FilePartRenderer } from "../FilePartRenderer";
import { downloadFromUrl } from "@/lib/utils/file-download";

jest.mock("@/lib/utils/file-download", () => ({ downloadFromUrl: jest.fn() }));
jest.mock("../../contexts/FileUrlCacheContext", () => ({
  useFileUrlCacheContext: () => null,
}));

it("restores focus to a mouse-clicked transcript image when the browser omits button focus", () => {
  render(
    <>
      <button>Previous focus</button>
      <FilePartRenderer
        part={{
          url: "/test-image.png",
          mediaType: "image/png",
          name: "Landscape",
        }}
        partIndex={0}
        messageId="message-1"
      />
    </>,
  );
  const opener = screen.getByRole("button", {
    name: "View Landscape in full size",
  });
  screen.getByRole("button", { name: "Previous focus" }).focus();
  fireEvent.click(opener);
  expect(screen.getByRole("dialog")).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

function ViewerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open image</button>
      <ImageViewer
        isOpen={open}
        onClose={() => setOpen(false)}
        imageSrc="/test-image.png"
        imageAlt="Test landscape"
        fileName="landscape.png"
      />
      <button>Background action</button>
    </>
  );
}

async function openViewer() {
  const user = userEvent.setup();
  render(<ViewerHarness />);
  await user.click(screen.getByRole("button", { name: "Open image" }));
  return { user, dialog: screen.getByRole("dialog", { name: "Image Viewer" }) };
}

it("contains the image and every viewer control in the accessible modal", async () => {
  const { dialog } = await openViewer();
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAccessibleDescription("Test landscape");
  expect(
    within(dialog).getByRole("img", { name: "Test landscape" }),
  ).toBeInTheDocument();
  for (const name of [
    "Download image",
    "Zoom out",
    "Zoom in",
    "Close image viewer",
  ]) {
    expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
  }
});

it("keeps Tab and Shift+Tab within the controls and restores focus after Escape", async () => {
  const { user, dialog } = await openViewer();
  expect(dialog).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Download image" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Zoom out" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Zoom in" })).toHaveFocus();
  await user.tab();
  expect(
    screen.getByRole("button", { name: "Close image viewer" }),
  ).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Download image" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(
    screen.getByRole("button", { name: "Close image viewer" }),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open image" })).toHaveFocus();
});

it("wraps backward from initial dialog focus and skips disabled zoom controls", async () => {
  const { user } = await openViewer();
  await user.tab({ shift: true });
  expect(
    screen.getByRole("button", { name: "Close image viewer" }),
  ).toHaveFocus();
  const zoomOut = screen.getByRole("button", { name: "Zoom out" });
  for (let count = 0; count < 3; count++) await user.click(zoomOut);
  expect(zoomOut).toBeDisabled();
  screen.getByRole("button", { name: "Download image" }).focus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Zoom in" })).toHaveFocus();
});

it("preserves download arguments and skips the busy download while tabbing", async () => {
  let finish!: () => void;
  (downloadFromUrl as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { user } = await openViewer();
  await user.click(screen.getByRole("button", { name: "Download image" }));
  expect(downloadFromUrl).toHaveBeenCalledWith({
    url: "/test-image.png",
    filename: "landscape.png",
  });
  expect(screen.getByRole("button", { name: "Download image" })).toBeDisabled();
  screen.getByRole("button", { name: "Close image viewer" }).focus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Zoom out" })).toHaveFocus();
  await act(async () => {
    finish();
  });
  expect(screen.getByRole("button", { name: "Download image" })).toBeEnabled();
});

it("preserves canvas zoom and close-button behavior", async () => {
  const { user } = await openViewer();
  const canvas = screen.getByRole("img", { name: "Test landscape" })
    .parentElement!.parentElement!;
  fireEvent.wheel(canvas, { deltaY: -100, clientX: 200, clientY: 200 });
  expect(screen.getByText("125%")).toBeInTheDocument();
  fireEvent.doubleClick(canvas, { clientX: 200, clientY: 200 });
  expect(screen.getByText("200%")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close image viewer" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open image" })).toHaveFocus();
});

it("preserves pointer panning and does not dismiss on the click after a drag", async () => {
  const { user } = await openViewer();
  await user.click(screen.getByRole("button", { name: "Zoom in" }));
  const frame = screen.getByRole("img", {
    name: "Test landscape",
  }).parentElement!;
  const canvas = frame.parentElement!;
  canvas.setPointerCapture = jest.fn();
  canvas.releasePointerCapture = jest.fn();
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, "pointerId", { value: 7 });
    fireEvent(canvas, event);
  };
  pointer("pointerdown", 100, 100);
  pointer("pointermove", 120, 130);
  pointer("pointerup", 120, 130);
  expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);
  expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(frame.style.transform).toBe("translate3d(20px, 30px, 0) scale(1.25)");
  fireEvent.click(canvas, { clientX: 120, clientY: 130 });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(canvas, { clientX: 120, clientY: 130 });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open image" })).toHaveFocus();
});
