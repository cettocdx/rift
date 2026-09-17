import { act, renderHook, waitFor } from "@testing-library/react";

import {
  DESKTOP_TERMINAL_OWNER_CHANGED_EVENT,
  DESKTOP_TERMINAL_OWNER_READY_EVENT,
} from "@/app/services/desktop-terminal-owner";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import {
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
  listDesktopWorkspaceGrants,
  requestDesktopWorkspaceAccess,
  revokeDesktopWorkspaceAccess,
  type DesktopWorkspaceGrant,
} from "@/app/services/desktop-local-access";
import { useDesktopWorkspaceAccess } from "../useDesktopWorkspaceAccess";

jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: jest.fn(),
}));

jest.mock("@/app/services/desktop-local-access", () => ({
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT: "rift:desktop-local-access-changed",
  listDesktopWorkspaceGrants: jest.fn(),
  requestDesktopWorkspaceAccess: jest.fn(),
  revokeDesktopWorkspaceAccess: jest.fn(),
}));

const mockIsTauri = jest.mocked(isTauriEnvironment);
const mockListGrants = jest.mocked(listDesktopWorkspaceGrants);
const mockRequestAccess = jest.mocked(requestDesktopWorkspaceAccess);
const mockRevokeAccess = jest.mocked(revokeDesktopWorkspaceAccess);

const grant: DesktopWorkspaceGrant = {
  grantId: "grant-1",
  name: "project",
  rootPath: "/Users/demo/project",
  writable: false,
  grantedAt: 42,
};

describe("useDesktopWorkspaceAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTauri.mockReturnValue(false);
    mockListGrants.mockResolvedValue([]);
    mockRequestAccess.mockResolvedValue(null);
    mockRevokeAccess.mockResolvedValue(false);
  });

  it("reports the web client as unavailable without calling the native bridge", async () => {
    const { result } = renderHook(() => useDesktopWorkspaceAccess());

    await waitFor(() =>
      expect(result.current.desktopState).toBe("unavailable"),
    );
    expect(result.current.grants).toEqual([]);
    expect(mockListGrants).not.toHaveBeenCalled();
  });

  it("refreshes the visible session after a native folder grant", async () => {
    mockIsTauri.mockReturnValue(true);
    mockListGrants.mockResolvedValueOnce([]).mockResolvedValueOnce([grant]);
    mockRequestAccess.mockResolvedValue(grant);
    const { result } = renderHook(() => useDesktopWorkspaceAccess());

    await waitFor(() => expect(result.current.desktopState).toBe("ready"));
    await act(async () => {
      await result.current.requestAccess(false);
    });

    expect(mockRequestAccess).toHaveBeenCalledWith({ writable: false });
    expect(result.current.grants).toEqual([grant]);
    expect(result.current.busyAction).toBeNull();
  });

  it("updates the activity indicator from the native session event", async () => {
    mockIsTauri.mockReturnValue(true);
    const { result } = renderHook(() => useDesktopWorkspaceAccess());
    await waitFor(() => expect(result.current.desktopState).toBe("ready"));

    act(() => {
      window.dispatchEvent(
        new CustomEvent<DesktopWorkspaceGrant[]>(
          DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
          { detail: [grant] },
        ),
      );
    });

    expect(result.current.grants).toEqual([grant]);
  });

  it("revokes only the selected opaque grant id", async () => {
    mockIsTauri.mockReturnValue(true);
    mockListGrants.mockResolvedValueOnce([grant]).mockResolvedValueOnce([]);
    mockRevokeAccess.mockResolvedValue(true);
    const { result } = renderHook(() => useDesktopWorkspaceAccess());
    await waitFor(() => expect(result.current.grants).toEqual([grant]));

    await act(async () => {
      await result.current.revokeAccess("grant-1");
    });

    expect(mockRevokeAccess).toHaveBeenCalledWith("grant-1");
    expect(result.current.grants).toEqual([]);
  });
  it("clears prior-account grants and ignores a stale refresh until owner-ready reloads consent", async () => {
    mockIsTauri.mockReturnValue(true);
    let resolve!: (grants: DesktopWorkspaceGrant[]) => void;
    mockListGrants
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce([]);
    const { result } = renderHook(() => useDesktopWorkspaceAccess());
    act(() =>
      window.dispatchEvent(new Event(DESKTOP_TERMINAL_OWNER_CHANGED_EVENT)),
    );
    await act(async () => resolve([grant]));
    expect(result.current.grants).toEqual([]);
    act(() =>
      window.dispatchEvent(new Event(DESKTOP_TERMINAL_OWNER_READY_EVENT)),
    );
    await waitFor(() => expect(result.current.desktopState).toBe("ready"));
    expect(mockListGrants).toHaveBeenCalledTimes(2);
    expect(result.current.grants).toEqual([]);
  });
});
