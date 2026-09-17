import { fireEvent, render, screen } from "@testing-library/react";
import { ExposePreviewCard } from "../ExposePreviewCard";

const setBuildPreviewUrl = jest.fn();
const setBuildPreviewOpen = jest.fn();
jest.mock("../../contexts/GlobalState", () => ({
  useGlobalState: () => ({
    setBuildPreviewUrl,
    setBuildPreviewOpen,
    buildPreviewUrl: null,
    buildPreviewOpen: false,
  }),
}));

describe("Preview follows user intent", () => {
  beforeEach(() => jest.clearAllMocks());
  it("does not open or change panels when a preview arrives or is replayed", () => {
    const { rerender } = render(
      <ExposePreviewCard url="https://preview.example/first" />,
    );
    rerender(<ExposePreviewCard url="https://preview.example/next" />);
    expect(setBuildPreviewOpen).not.toHaveBeenCalled();
    expect(setBuildPreviewUrl).not.toHaveBeenCalled();
  });
  it("opens the selected preview on an explicit click", () => {
    render(<ExposePreviewCard url="https://preview.example/app" />);
    fireEvent.click(screen.getByRole("button", { name: /Preview available/ }));
    expect(setBuildPreviewUrl).toHaveBeenLastCalledWith(
      "https://preview.example/app",
    );
    expect(setBuildPreviewOpen).toHaveBeenLastCalledWith(true);
  });
});
