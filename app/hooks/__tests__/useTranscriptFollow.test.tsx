import { fireEvent, render, screen } from "@testing-library/react";
import { useTranscriptFollow } from "../useTranscriptFollow";

function Transcript({ revision }: { revision: number }) {
  const { scrollRef, following, onScroll, followLatest } =
    useTranscriptFollow(revision);
  return (
    <>
      <div ref={scrollRef} onScroll={onScroll} data-testid="output" />
      {!following && <button onClick={followLatest}>Latest activity</button>}
    </>
  );
}

function dimensions(element: HTMLElement, height: number) {
  Object.defineProperties(element, {
    scrollHeight: { value: height, configurable: true },
    clientHeight: { value: 400, configurable: true },
  });
}

it("new chunks preserve the reading position until the reader requests latest activity", () => {
  const { rerender } = render(<Transcript revision={0} />);
  const output = screen.getByTestId("output");
  dimensions(output, 2000);
  output.scrollTop = 500;
  fireEvent.scroll(output);
  dimensions(output, 3000);
  rerender(<Transcript revision={1} />);
  expect(output.scrollTop).toBe(500);
  output.scrollTo = jest.fn();
  fireEvent.click(screen.getByRole("button", { name: "Latest activity" }));
  expect(output.scrollTo).toHaveBeenCalledWith(
    expect.objectContaining({ top: 3000 }),
  );
  expect(screen.queryByRole("button")).toBeNull();
  dimensions(output, 3500);
  rerender(<Transcript revision={2} />);
  expect(output.scrollTop).toBe(3500);
});

it("keeps following streamed output when the reader remains at the bottom", () => {
  const { rerender } = render(<Transcript revision={0} />);
  const output = screen.getByTestId("output");
  dimensions(output, 2000);
  output.scrollTop = 1580;
  fireEvent.scroll(output);
  dimensions(output, 2600);
  rerender(<Transcript revision={1} />);
  expect(output.scrollTop).toBe(2600);
  expect(screen.queryByRole("button")).toBeNull();
});
