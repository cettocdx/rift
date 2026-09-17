import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileUploadPreview } from "../FileUploadPreview";

describe("FileUploadPreview media roles", () => {
  const uploadedImage = {
    file: new File([new Uint8Array([137, 80, 78, 71])], "reference.png", {
      type: "image/png",
    }),
    uploading: false,
    uploaded: true,
    fileId: "file-1",
    storage: "s3" as const,
  };

  it("restores focus to a mouse-clicked image opener without native button focus", async () => {
    render(
      <>
        <button>Previous focus</button>
        <FileUploadPreview
          uploadedFiles={[uploadedImage]}
          onRemoveFile={jest.fn()}
        />
      </>,
    );
    const opener = await screen.findByRole("button", { name: "reference.png" });
    screen.getByRole("button", { name: "Previous focus" }).focus();
    // macOS WebKit does not focus buttons on a pointer click.
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("labels an image as an image-generation reference", async () => {
    render(
      <FileUploadPreview
        uploadedFiles={[uploadedImage]}
        onRemoveFile={jest.fn()}
        mediaKind="image"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Reference")).toBeInTheDocument(),
    );
  });

  it("labels an image as video guidance without changing ordinary files", async () => {
    render(
      <FileUploadPreview
        uploadedFiles={[
          uploadedImage,
          {
            file: new File(["brief"], "brief.txt", { type: "text/plain" }),
            uploading: false,
            uploaded: true,
            fileId: "file-2",
            storage: "s3",
          },
        ]}
        onRemoveFile={jest.fn()}
        mediaKind="video"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Video guide")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Video guide")).toHaveLength(1);
  });
});
