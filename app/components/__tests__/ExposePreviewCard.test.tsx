import { render, screen, fireEvent } from "@testing-library/react";
import { ExposePreviewCard } from "../ExposePreviewCard";

const setBuildPreviewUrl = jest.fn();
const setBuildPreviewOpen = jest.fn();
let buildPreviewOpen = false;
let buildPreviewUrl: string | null = "https://preview.example";

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    buildPreviewUrl,
    buildPreviewOpen,
    setBuildPreviewUrl,
    setBuildPreviewOpen,
  }),
}));

describe("ExposePreviewCard", () => {
  beforeEach(() => {
    buildPreviewOpen = false;
    buildPreviewUrl = "https://preview.example";
    jest.clearAllMocks();
  });

  it("does not claim a closed preview is shown", () => {
    render(<ExposePreviewCard url="https://preview.example" />);

    expect(screen.getByText("Open")).toBeVisible();
    expect(screen.queryByText("Shown")).not.toBeInTheDocument();
    expect(screen.getByText("Preview available")).toBeVisible();
  });

  it("marks the matching preview as shown only while its pane is open", () => {
    buildPreviewOpen = true;

    render(<ExposePreviewCard url="https://preview.example" />);

    expect(screen.getByText("Shown")).toBeVisible();
  });

  it("keeps a reused preview inline and opens it only on user request", () => {
    const url = "https://reused-preview.example";
    const first = render(<ExposePreviewCard url={url} />);
    first.unmount();
    jest.clearAllMocks();
    buildPreviewUrl = null;

    render(<ExposePreviewCard url={url} />);

    expect(setBuildPreviewOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button"));
    expect(setBuildPreviewUrl).toHaveBeenCalledWith(url);
    expect(setBuildPreviewOpen).toHaveBeenCalledWith(true);
  });
});
