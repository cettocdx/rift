import { prepareWorkingFileRequest } from "../working-file-request";
import {
  setWorkingFile,
  readWorkingFileRequestContext,
} from "../working-file-store";
import { listDesktopWorkspaceGrants } from "@/app/services/desktop-local-access";
import { isTauriEnvironment } from "@/app/hooks/useTauri";

jest.mock("@/app/services/desktop-local-access", () => ({
  listDesktopWorkspaceGrants: jest.fn(),
}));
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: jest.fn(() => true),
}));
const file = {
  grantId: "bbbf3042-fffb-4641-9b71-19d227242e51",
  name: "notes.md",
  relativePath: "notes.md",
};

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  (isTauriEnvironment as jest.Mock).mockReturnValue(true);
  (listDesktopWorkspaceGrants as jest.Mock).mockResolvedValue([
    { ...file, kind: "file", writable: true },
  ]);
});

it("includes only the selected opaque reference for a ready native grant", async () => {
  setWorkingFile("chat-a", file);
  await expect(prepareWorkingFileRequest("chat-a", true)).resolves.toEqual(
    file,
  );
  expect(JSON.stringify(readWorkingFileRequestContext("chat-a"))).not.toContain(
    "rootPath",
  );
  await expect(
    prepareWorkingFileRequest("chat-b", true),
  ).resolves.toBeUndefined();
});

it("does not send when the relay is offline or the native grant has expired", async () => {
  setWorkingFile("chat-a", file);
  await expect(prepareWorkingFileRequest("chat-a", false)).rejects.toThrow(
    "offline",
  );
  (listDesktopWorkspaceGrants as jest.Mock).mockResolvedValue([]);
  await expect(prepareWorkingFileRequest("chat-a", true)).rejects.toThrow(
    "has ended",
  );
});

it("rejects a folder grant masquerading as a working file", async () => {
  setWorkingFile("chat-a", file);
  (listDesktopWorkspaceGrants as jest.Mock).mockResolvedValue([
    { ...file, kind: "directory", writable: true },
  ]);
  await expect(prepareWorkingFileRequest("chat-a", true)).rejects.toThrow(
    "has ended",
  );
});

it("does not submit a native reference from a browser session", async () => {
  setWorkingFile("chat-a", file);
  (isTauriEnvironment as jest.Mock).mockReturnValue(false);
  await expect(prepareWorkingFileRequest("chat-a", true)).rejects.toThrow(
    "offline",
  );
});

it("rejects malformed stored references and clears only the requested chat", () => {
  window.sessionStorage.setItem(
    "rift:working-file:bad",
    '{"grantId":"x","relativePath":"/etc/passwd"}',
  );
  expect(readWorkingFileRequestContext("bad")).toBeUndefined();
  setWorkingFile("chat-a", file);
  setWorkingFile("chat-b", file);
  setWorkingFile("chat-a", null);
  expect(readWorkingFileRequestContext("chat-a")).toBeUndefined();
  expect(readWorkingFileRequestContext("chat-b")).toEqual(file);
});
