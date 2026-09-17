import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockMutation = jest.fn(async () => ({ ok: true }));
let currentPage: "layout" | "users" | "conversations" = "layout";
let queryCall = 0;

const stats = {
  totalUsers: 1,
  totalRevenueDollars: 12,
  activeLast7Days: 1,
  totalChats: 1,
  limited: {
    users: false,
    revenue: false,
    balances: false,
    chats: false,
    subscriptions: false,
  },
  users: [
    {
      id: "user_ada_0001",
      email: "ada@example.com",
      name: "Ada Lovelace",
      joinedAt: 1_700_000_000_000,
      balancePoints: 125_000,
      revenueDollars: 12,
      lastActiveAt: Date.now(),
      tier: "pro",
      subStatus: "active",
      chatCount: 1,
    },
  ],
};

const activity = [
  {
    chatId: "chat-1",
    title: "Keyboard audit",
    userId: "user_ada_0001",
    email: "ada@example.com",
    name: "Ada Lovelace",
    mode: "build",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
  },
];

const transcript = [
  {
    id: "message-1",
    role: "user",
    text: "Check the keyboard flow.",
    mode: "build",
    createdAt: 1_700_000_000_000,
  },
];

jest.mock("convex/react", () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/admin/users",
}));

const { useMutation, useQuery } = jest.requireMock<{
  useMutation: ReturnType<typeof jest.fn>;
  useQuery: ReturnType<typeof jest.fn>;
}>("convex/react");
const AdminLayout =
  jest.requireActual<typeof import("../layout")>("../layout").default;
const UsersPage =
  jest.requireActual<typeof import("../users/page")>("../users/page").default;
const ConversationsPage = jest.requireActual<
  typeof import("../conversations/page")
>("../conversations/page").default;

describe("admin accessibility contracts", () => {
  beforeEach(() => {
    currentPage = "layout";
    queryCall = 0;
    useMutation.mockReturnValue(mockMutation);
    useQuery.mockImplementation((_query: unknown, args?: unknown) => {
      if (currentPage === "layout") return true;
      if (
        currentPage === "conversations" &&
        args &&
        typeof args === "object" &&
        "chatId" in args
      ) {
        return transcript;
      }
      if (currentPage === "conversations") return activity;
      return queryCall++ % 2 === 0 ? stats : activity;
    });
  });

  it("provides a focus-managed mobile admin navigation", async () => {
    render(
      <AdminLayout>
        <div>Admin content</div>
      </AdminLayout>,
    );

    const trigger = screen.getByRole("button", {
      name: "Open admin navigation",
    });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Admin navigation" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Users" })[0]).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("exposes labeled user controls, sort state, and a keyboard dialog action", async () => {
    currentPage = "users";
    render(<UsersPage />);

    expect(
      screen.getByRole("searchbox", { name: "Search users" }),
    ).toHaveAttribute("aria-controls", "admin-users-table");

    const joinedHeader = screen.getByRole("columnheader", {
      name: "Joined",
    });
    expect(joinedHeader).toHaveAttribute("aria-sort", "none");
    fireEvent.click(
      screen.getByRole("button", { name: /Joined: not sorted/i }),
    );
    expect(joinedHeader).toHaveAttribute("aria-sort", "descending");

    const details = screen.getByRole("button", {
      name: "View details for Ada Lovelace",
    });
    details.focus();
    fireEvent.click(details);

    const dialog = screen.getByRole("dialog", { name: "Ada Lovelace" });
    expect(
      screen.getByRole("textbox", { name: "Custom token amount" }),
    ).toHaveAttribute("inputmode", "numeric");
    expect(
      screen.getByRole("button", { name: "Close user details" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(details).toHaveFocus();
  });

  it("uses a real button to open a labeled conversation transcript", async () => {
    currentPage = "conversations";
    render(<ConversationsPage />);

    expect(
      screen.getByRole("searchbox", { name: "Search conversations" }),
    ).toHaveAttribute("aria-controls", "admin-conversations-table");

    const open = screen.getByRole("button", {
      name: "Open transcript: Keyboard audit",
    });
    open.focus();
    fireEvent.click(open);

    const dialog = screen.getByRole("dialog", { name: "Keyboard audit" });
    expect(screen.getByText("Check the keyboard flow.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Close conversation transcript",
      }),
    ).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(open).toHaveFocus();
  });
});
