import { invoke } from "@tauri-apps/api/core";
import {
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
  listDesktopWorkspaceGrants,
  requestDesktopWorkspaceAccess,
  requestDesktopFileAccess,
  revokeDesktopWorkspaceAccess,
  writeDesktopWorkspaceFile,
  disconnectDesktopCapabilities,
} from "../desktop-local-access";

jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: jest.fn(() => true),
}));

jest.mock("@tauri-apps/api/core", () => ({ invoke: jest.fn() }));

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>;

describe("desktop local access service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockReset();
  });

  it("clears native workspace grants and pending consent on sign out", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const listener = jest.fn();
    window.addEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, listener);
    try {
      await disconnectDesktopCapabilities();
      expect(mockInvoke).toHaveBeenCalledWith(
        "revoke_all_desktop_access",
        undefined,
      );
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ detail: [] }),
      );
    } finally {
      window.removeEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, listener);
    }
  });

  it.each([
    "Command revoke_all_desktop_access not found",
    "revoke_all_desktop_access not allowed. Command not found",
  ])(
    "revokes old-shell device and workspace grants when unavailable: %s",
    async (missing) => {
      mockInvoke.mockImplementation(async (command) => {
        if (command === "revoke_all_desktop_access") throw missing;
        if (command === "list_workspace_grants")
          return [{ grantId: "file-1" }, { grantId: "folder-2" }];
        return true;
      });
      await disconnectDesktopCapabilities();
      expect(mockInvoke).toHaveBeenCalledWith("set_desktop_access", {
        capability: "local_web",
        enabled: false,
      });
      expect(mockInvoke).toHaveBeenCalledWith("set_desktop_access", {
        capability: "computer",
        enabled: false,
      });
      expect(mockInvoke).toHaveBeenCalledWith("revoke_workspace_access", {
        grantId: "file-1",
      });
      expect(mockInvoke).toHaveBeenCalledWith("revoke_workspace_access", {
        grantId: "folder-2",
      });
    },
  );

  it.each([
    "Local access state is unavailable.",
    "revoke_all_desktop_access not allowed. Permissions associated with this command: allow-desktop-local-access",
  ])("preserves native failure without falling back: %s", async (failure) => {
    mockInvoke.mockRejectedValue(failure);
    await expect(disconnectDesktopCapabilities()).rejects.toBe(failure);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("attempts every legacy revocation and reports failures without announcing success", async () => {
    const failure = new Error("Could not disable computer control");
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "revoke_all_desktop_access")
        throw "Command revoke_all_desktop_access not found";
      if (
        command === "set_desktop_access" &&
        (args as { capability: string }).capability === "computer"
      )
        throw failure;
      if (command === "list_workspace_grants")
        return [{ grantId: "file-1" }, { grantId: "folder-2" }];
      return true;
    });
    const listener = jest.fn();
    window.addEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, listener);
    try {
      await expect(disconnectDesktopCapabilities()).rejects.toBe(failure);
      expect(mockInvoke).toHaveBeenCalledWith("revoke_workspace_access", {
        grantId: "file-1",
      });
      expect(mockInvoke).toHaveBeenCalledWith("revoke_workspace_access", {
        grantId: "folder-2",
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, listener);
    }
  });

  it("requests native folder consent and publishes the resulting grant list", async () => {
    const grant = {
      grantId: "grant-1",
      name: "project",
      rootPath: "/Users/test/project",
      writable: true,
      grantedAt: 42,
    };
    mockInvoke.mockResolvedValueOnce(grant).mockResolvedValueOnce([grant]);
    const listener = jest.fn();
    window.addEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, listener);

    await expect(
      requestDesktopWorkspaceAccess({ writable: true }),
    ).resolves.toEqual(grant);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "request_workspace_access", {
      writable: true,
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: [grant] }),
    );
    window.removeEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, listener);
  });

  it("revokes only the opaque native grant id", async () => {
    mockInvoke.mockResolvedValueOnce(true).mockResolvedValueOnce([]);
    await expect(revokeDesktopWorkspaceAccess("grant-1")).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "revoke_workspace_access", {
      grantId: "grant-1",
    });
  });

  it("keeps writes relative to a selected grant", async () => {
    mockInvoke.mockResolvedValueOnce({ relativePath: "src/app.ts", size: 4 });
    await writeDesktopWorkspaceFile({
      grantId: "grant-1",
      relativePath: "src/app.ts",
      content: "test",
    });
    expect(mockInvoke).toHaveBeenCalledWith("write_workspace_file", {
      grantId: "grant-1",
      relativePath: "src/app.ts",
      content: "test",
      encoding: "utf8",
    });
  });

  it("lists native grants without transforming their capability flags", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await expect(listDesktopWorkspaceGrants()).resolves.toEqual([]);
  });

  it("opens the native file picker and announces the opaque single-file grant", async () => {
    const grant = {
      grantId: "grant-file",
      name: "notes.md",
      relativePath: "notes.md",
      kind: "file",
      writable: true,
      grantedAt: 1,
    };
    mockInvoke.mockResolvedValueOnce(grant).mockResolvedValueOnce([grant]);
    await expect(requestDesktopFileAccess()).resolves.toEqual(grant);
    expect(mockInvoke).toHaveBeenNthCalledWith(
      1,
      "request_file_access",
      undefined,
    );
    expect(mockInvoke).toHaveBeenNthCalledWith(
      2,
      "list_workspace_grants",
      undefined,
    );
  });

  it("does not change grants when the native picker is cancelled", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    await expect(requestDesktopFileAccess()).resolves.toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("forwards empty writes with the version read from the original file", async () => {
    mockInvoke.mockResolvedValueOnce({
      relativePath: "notes.md",
      size: 0,
      version: "next",
    });
    await writeDesktopWorkspaceFile({
      grantId: "grant-file",
      relativePath: "notes.md",
      content: "",
      expectedVersion: "previous",
    });
    expect(mockInvoke).toHaveBeenCalledWith("write_workspace_file", {
      grantId: "grant-file",
      relativePath: "notes.md",
      content: "",
      encoding: "utf8",
      expectedVersion: "previous",
    });
  });
});
