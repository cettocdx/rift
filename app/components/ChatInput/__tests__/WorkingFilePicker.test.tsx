import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { WorkingFilePicker } from "../WorkingFilePicker";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import {
  listDesktopWorkspaceGrants,
  requestDesktopFileAccess,
  revokeDesktopWorkspaceAccess,
} from "@/app/services/desktop-local-access";
import {
  readWorkingFileRequestContext,
  setWorkingFile,
} from "@/lib/composer/working-file-store";

jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: jest.fn(() => true),
}));
jest.mock("@/app/services/desktop-local-access", () => ({
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT: "rift:desktop-local-access-changed",
  requestDesktopFileAccess: jest.fn(),
  revokeDesktopWorkspaceAccess: jest.fn(),
  listDesktopWorkspaceGrants: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { info: jest.fn(), error: jest.fn() } }));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({ desktopBridgeActive: true }),
}));
const grant = {
  grantId: "bbbf3042-fffb-4641-9b71-19d227242e51",
  name: "notes.md",
  relativePath: "notes.md",
  kind: "file",
  writable: true,
  grantedAt: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  (isTauriEnvironment as jest.Mock).mockReturnValue(true);
  (requestDesktopFileAccess as jest.Mock).mockResolvedValue(grant);
  (listDesktopWorkspaceGrants as jest.Mock).mockResolvedValue([grant]);
  (revokeDesktopWorkspaceAccess as jest.Mock).mockResolvedValue(true);
});

it("opens the native file picker directly and binds the original file to only this chat", async () => {
  const { rerender } = render(<WorkingFilePicker chatId="chat-a" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Open a file from your computer" }),
  );
  expect(await screen.findByText("notes.md")).toBeVisible();
  expect(requestDesktopFileAccess).toHaveBeenCalledTimes(1);
  expect(readWorkingFileRequestContext("chat-a")).toEqual({
    grantId: grant.grantId,
    name: grant.name,
    relativePath: grant.relativePath,
  });
  expect(readWorkingFileRequestContext("chat-b")).toBeUndefined();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.queryByText("Files")).not.toBeInTheDocument();
  rerender(<WorkingFilePicker chatId="chat-b" />);
  expect(screen.queryByText("notes.md")).not.toBeInTheDocument();
  expect(screen.getByText("Open file")).toBeVisible();
});

it("keeps the current working file when another selection is cancelled", async () => {
  setWorkingFile("chat-a", {
    grantId: grant.grantId,
    name: grant.name,
    relativePath: grant.relativePath,
  });
  (requestDesktopFileAccess as jest.Mock).mockResolvedValue(null);
  render(<WorkingFilePicker chatId="chat-a" />);
  fireEvent.click(screen.getByRole("button", { name: /Working file/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Working file/ })).toBeEnabled(),
  );
  expect(readWorkingFileRequestContext("chat-a")?.grantId).toBe(grant.grantId);
  expect(revokeDesktopWorkspaceAccess).not.toHaveBeenCalled();
});

it("revokes only the selected grant when closing a file", async () => {
  setWorkingFile("chat-a", {
    grantId: grant.grantId,
    name: grant.name,
    relativePath: grant.relativePath,
  });
  render(<WorkingFilePicker chatId="chat-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Close notes.md" }));
  await waitFor(() => expect(screen.getByText("Open file")).toBeVisible());
  expect(revokeDesktopWorkspaceAccess).toHaveBeenCalledWith(grant.grantId);
  expect(readWorkingFileRequestContext("chat-a")).toBeUndefined();
});

it("shows expired native access and does not silently swap the original for an upload", async () => {
  setWorkingFile("chat-a", {
    grantId: grant.grantId,
    name: grant.name,
    relativePath: grant.relativePath,
  });
  (listDesktopWorkspaceGrants as jest.Mock).mockResolvedValue([]);
  render(<WorkingFilePicker chatId="chat-a" />);
  expect(await screen.findByText("Reselect file")).toBeInTheDocument();
  expect(readWorkingFileRequestContext("chat-a")?.grantId).toBe(grant.grantId);
});

it("keeps the run's file selection fixed while generating", async () => {
  setWorkingFile("chat-a", {
    grantId: grant.grantId,
    name: grant.name,
    relativePath: grant.relativePath,
  });
  await act(async () => {
    render(<WorkingFilePicker chatId="chat-a" disabled />);
  });
  expect(screen.getByRole("button", { name: /Working file/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close notes.md" })).toBeDisabled();
});

it("explains the desktop requirement in a browser without pretending an upload edits the original", () => {
  (isTauriEnvironment as jest.Mock).mockReturnValue(false);
  render(<WorkingFilePicker chatId="chat-a" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Open a file from your computer" }),
  );
  expect(toast.info).toHaveBeenCalledWith(
    "Open RIFT Desktop to work on the original file.",
    expect.any(Object),
  );
  expect(requestDesktopFileAccess).not.toHaveBeenCalled();
  expect(readWorkingFileRequestContext("chat-a")).toBeUndefined();
});
