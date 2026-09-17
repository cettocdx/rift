import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import SidebarHistory from "../SidebarHistory";
jest.mock("../SidebarConversation", () => ({
  SidebarConversation: ({ chat }: any) => <span>{chat.title}</span>,
}));
jest.mock("../SidebarHeader", () => ({ SIDEBAR_SECTION_LABEL_CLASS: "" }));
it("groups visible conversations by recency and collapses each group independently", () => {
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
  ).getTime();
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    12,
  ).getTime();
  render(
    <SidebarHistory
      chats={[
        { _id: "a", title: "Current task", update_time: today },
        { _id: "b", title: "Prior task", update_time: yesterday },
        { _id: "c", title: "Archived task", update_time: 1 },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(screen.queryByText("Current task")).not.toBeInTheDocument();
  expect(screen.getByText("Prior task")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Older" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(screen.getByText("Current task")).toBeInTheDocument();
});
