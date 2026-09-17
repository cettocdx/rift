import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "convex/react";
import { ArtifactsGallery } from "../ArtifactsGallery";

jest.mock("convex/react", () => ({ useQuery: jest.fn() }));
jest.mock("@/convex/_generated/api", () => ({
  api: { artifacts: { listForUser: "artifacts:listForUser" } },
}));
const library = [1, 2, 3].map((time) => ({
  url: `https://assets.example.test/${time}.webp`,
  mediaType: "image/webp",
  kind: "generated",
  chat_id: "chat-1",
  time,
}));

beforeEach(() => jest.mocked(useQuery).mockReturnValue(library as never));

it.each(["Escape", "Close"])(
  "restores the originating card after %s",
  async (dismiss) => {
    const user = userEvent.setup();
    render(<ArtifactsGallery />);
    const cards = screen.getAllByRole("button", {
      name: "Open generated image artifact",
    });
    cards[1].focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    if (dismiss === "Escape") await user.keyboard("{Escape}");
    else
      await user.click(
        within(dialog).getByRole("button", { name: "Close", exact: true }),
      );
    await waitFor(() => expect(cards[1]).toHaveFocus());
    await user.tab();
    expect(cards[2]).toHaveFocus();
  },
);

it("returns to the active filter when a live update removes the original card", async () => {
  const user = userEvent.setup();
  const view = render(<ArtifactsGallery />);
  const filter = screen.getByRole("button", { name: /^Generated / });
  await user.click(filter);
  const card = screen.getAllByRole("button", {
    name: "Open generated image artifact",
  })[1];
  await user.click(card);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  jest.mocked(useQuery).mockReturnValue([] as never);
  view.rerender(<ArtifactsGallery />);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(filter).toHaveFocus());
  expect(filter).toHaveAttribute("aria-pressed", "true");
});
