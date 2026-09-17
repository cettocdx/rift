import { fireEvent, render, screen } from "@testing-library/react";
import { FilePartRenderer } from "../FilePartRenderer";
jest.mock("../ImageViewer", () => ({ ImageViewer: () => null }));
jest.mock("../../contexts/FileUrlCacheContext", () => ({
  useFileUrlCacheContext: () => null,
}));
jest.mock("../../hooks/useTauri", () => ({ isTauriEnvironment: () => false }));
jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ fill, alt, ...props }: any) => (
    // Native image intentionally substitutes next/image in the DOM test.
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} data-fill={String(!!fill)} {...props} />
  ),
}));
it("reserves the generated image canvas before decode and keeps it after load", () => {
  const { container } = render(
    <FilePartRenderer
      part={
        {
          url: "https://example.com/image.png",
          mediaType: "image/png",
          aspectRatio: "16:9",
        } as any
      }
      partIndex={0}
      messageId="m"
      large
    />,
  );
  const image = screen.getByRole("img");
  expect(image).toHaveAttribute("data-fill", "true");
  expect(image).not.toHaveAttribute("height", "2048");
  const frame = container.querySelector('[data-ui="inline-image-frame"]');
  expect(frame).toHaveClass("aspect-video");
  const before = frame?.className;
  fireEvent.load(image);
  expect(frame?.className).toBe(before);
});
it("reserves portrait frames with the same layout as the generation placeholder", () => {
  const { container } = render(
    <FilePartRenderer
      part={
        {
          url: "https://example.com/portrait.png",
          mediaType: "image/png",
          aspectRatio: "9:16",
        } as any
      }
      partIndex={0}
      messageId="m"
      large
    />,
  );
  expect(container.querySelector('[data-ui="inline-image-frame"]')).toHaveClass(
    "aspect-[9/16]",
    "max-w-[22rem]",
  );
});
