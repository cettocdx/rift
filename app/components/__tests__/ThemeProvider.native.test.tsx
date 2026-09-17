import { act, render, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../ThemeProvider";

let mockTheme: string | undefined = "dark";
let mockNative = true;
const mockInvoke = jest.fn();
jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: mockTheme }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => mockNative,
}));
jest.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

beforeEach(() => {
  mockTheme = "dark";
  mockNative = true;
  mockInvoke.mockReset().mockResolvedValue(null);
});

it("updates the native window when the resolved app theme changes", async () => {
  const view = render(<ThemeProvider>App</ThemeProvider>);
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenLastCalledWith("set_desktop_theme", {
      theme: "dark",
    }),
  );
  mockTheme = "light";
  view.rerender(<ThemeProvider>App</ThemeProvider>);
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenLastCalledWith("set_desktop_theme", {
      theme: "light",
    }),
  );
});

it("does not send a guessed theme before hydration resolves it", async () => {
  mockTheme = undefined;
  render(<ThemeProvider>App</ThemeProvider>);
  await act(async () => {});
  expect(mockInvoke).not.toHaveBeenCalled();
});

it("does not load native commands on the web", async () => {
  mockNative = false;
  render(<ThemeProvider>App</ThemeProvider>);
  await act(async () => {});
  expect(mockInvoke).not.toHaveBeenCalled();
});

it("continues rendering with an older native build that lacks the theme command", async () => {
  mockInvoke.mockRejectedValue(new Error("Unknown command"));
  const view = render(<ThemeProvider>App</ThemeProvider>);
  await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
  expect(view.getByText("App")).toBeInTheDocument();
});

it("matches browser chrome to the selected theme rather than the OS preference", () => {
  mockNative = false;
  document.head
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((node) => node.remove());
  const view = render(<ThemeProvider>App</ThemeProvider>);
  expect(
    document.head.querySelector('meta[name="theme-color"]'),
  ).toHaveAttribute("content", "#000000");
  mockTheme = "light";
  view.rerender(<ThemeProvider>App</ThemeProvider>);
  expect(
    document.head.querySelectorAll('meta[name="theme-color"]'),
  ).toHaveLength(1);
  expect(
    document.head.querySelector('meta[name="theme-color"]'),
  ).toHaveAttribute("content", "#ffffff");
});
