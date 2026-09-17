import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { ProtectedPageBoundary } from "../ProtectedPageBoundary";
import TasksPage from "@/app/(chat)/tasks/page";

let pathname = "/plugins";
let searchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

jest.mock("convex/react", () => ({
  Authenticated: () => null,
  AuthLoading: () => null,
  Unauthenticated: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("@/app/components/tasks/TaskCenter", () => ({
  TaskCenter: () => null,
}));

it.each([
  ["plugins and skills", "/plugins", "tab=skills"],
  ["agents and teams", "/agents", ""],
  ["runs", "/runs/run-123", ""],
  ["artifacts", "/artifacts", ""],
  ["settings", "/settings/appearance", "q=interface"],
])(
  "takes the %s sign-in gate to login and preserves its destination",
  (resource, path, query) => {
    pathname = path;
    searchParams = new URLSearchParams(query);
    render(
      <ProtectedPageBoundary resource={resource}>
        Private content
      </ProtectedPageBoundary>,
    );
    const href = screen
      .getByRole("link", { name: "Go to sign in" })
      .getAttribute("href");
    const login = new URL(href!, "http://localhost");
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("redirect")).toBe(
      query ? `${path}?${query}` : path,
    );
    expect(screen.queryByText("Private content")).not.toBeInTheDocument();
  },
);

it("uses the same destination-preserving sign-in path for Tasks", () => {
  pathname = "/tasks";
  searchParams = new URLSearchParams();
  render(<TasksPage />);
  expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
    "href",
    "/login?redirect=%2Ftasks",
  );
});

it("never puts a protocol-relative path in the sign-in return target", () => {
  pathname = "//outside.example/path";
  searchParams = new URLSearchParams();
  render(
    <ProtectedPageBoundary resource="settings">
      Private content
    </ProtectedPageBoundary>,
  );
  expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
    "href",
    "/login?redirect=%2F",
  );
});
