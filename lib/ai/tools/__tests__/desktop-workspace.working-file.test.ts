/** @jest-environment node */
const mockRelay = jest.fn();
jest.mock("@/lib/desktop/local-access-relay", () => ({
  requestDesktopLocalAccess: (...args: unknown[]) => mockRelay(...args),
  DesktopLocalAccessError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
import { createDesktopWorkspaceToolSets } from "../desktop-workspace";
import { gateToolSet, requiresToolApproval } from "@/lib/ai/approval/policy";

const workingFile = {
  grantId: "2c097a16-0944-4f23-867c-cc8cde0aebf6",
  name: "notes.md",
  relativePath: "notes.md",
};
const other = "3c097a16-0944-4f23-867c-cc8cde0aebf6";
const grant = {
  ...workingFile,
  kind: "file",
  writable: true,
  grantedAt: 1,
  rootPath: "/Users/private/notes.md",
};
const options = { toolCallId: "read-1", messages: [] };
const run = async (tools: any, name: string, input: unknown) =>
  tools[name].execute(input, options);
const build = (selected = true) =>
  createDesktopWorkspaceToolSets({
    userId: "owner",
    serviceKey: "service",
    ...(selected ? { workingFile } : {}),
  });

beforeEach(() => {
  mockRelay.mockReset();
  mockRelay.mockImplementation(async ({ operation }) =>
    operation === "list_grants"
      ? [grant, { ...grant, grantId: other, name: "other.md" }]
      : {
          relativePath: "notes.md",
          content: "hello",
          encoding: "utf8",
          size: 5,
          version: "a".repeat(64),
        },
  );
});

describe("selected PC file tools", () => {
  it("lists only the selected file grant and omits every host path", async () => {
    const result = await run(build().all, "desktop_workspace_list_grants", {
      brief: "Inspect selection",
    });
    expect(result).toEqual({
      ok: true,
      grants: [{ ...workingFile, kind: "file", writable: true, grantedAt: 1 }],
    });
    expect(JSON.stringify(result)).not.toContain("/Users");
  });
  it.each([other, workingFile.grantId])(
    "rejects another grant or sibling path before native reads %s",
    async (id) => {
      const result = await run(build().all, "desktop_workspace_read", {
        grantId: id,
        relativePath: id === other ? "notes.md" : "sibling.md",
        brief: "Read",
      });
      expect(result.ok).toBe(false);
      expect(mockRelay).not.toHaveBeenCalled();
    },
  );
  it.each([
    { grants: [] },
    { grants: [{ ...grant, kind: "directory" }] },
    { grants: [{ ...grant, relativePath: "other.md" }] },
  ])(
    "denies missing, folder or changed native grants %#",
    async ({ grants }) => {
      mockRelay.mockResolvedValue(grants);
      const result = await run(build().all, "desktop_workspace_read", {
        ...workingFile,
        brief: "Read",
      });
      expect(result.ok).toBe(false);
      expect(mockRelay.mock.calls.map(([arg]) => arg.operation)).toEqual([
        "list_grants",
      ]);
    },
  );
  it("reads the original reference with version, and forwards an exact optimistic write", async () => {
    const tools = build().all;
    const result = await run(tools, "desktop_workspace_read", {
      ...workingFile,
      brief: "Read",
    });
    expect(result.file.version).toBe("a".repeat(64));
    await run(tools, "desktop_workspace_write", {
      ...workingFile,
      content: "",
      encoding: "utf8",
      expectedVersion: result.file.version,
      brief: "Update",
    });
    expect(mockRelay).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "write_file",
        payload: {
          grantId: workingFile.grantId,
          relativePath: "notes.md",
          content: "",
          encoding: "utf8",
          expectedVersion: "a".repeat(64),
        },
      }),
      expect.objectContaining({ serviceKey: "service" }),
    );
  });
  it("requires a version before any selected-file write", async () => {
    const result = await run(build().all, "desktop_workspace_write", {
      ...workingFile,
      content: "new",
      brief: "Update",
    });
    expect(result.ok).toBe(false);
    expect(
      mockRelay.mock.calls.some(([arg]) => arg.operation === "write_file"),
    ).toBe(false);
  });
  it("honors native read-only permission even in Agent/full mode", async () => {
    mockRelay.mockResolvedValue([{ ...grant, writable: false }]);
    const result = await run(build().all, "desktop_workspace_write", {
      ...workingFile,
      content: "new",
      expectedVersion: "a".repeat(64),
      brief: "Update",
    });
    expect(result.ok).toBe(false);
    expect(
      mockRelay.mock.calls.some(([arg]) => arg.operation === "write_file"),
    ).toBe(false);
  });
  it("does not enumerate the selected file's parent folder", async () => {
    const result = await run(build().all, "desktop_workspace_list", {
      grantId: workingFile.grantId,
      relativePath: "",
      brief: "List",
    });
    expect(result).toMatchObject({
      ok: true,
      entries: [{ name: "notes.md", relativePath: "notes.md", kind: "file" }],
    });
    expect(
      mockRelay.mock.calls.some(([arg]) => arg.operation === "list_entries"),
    ).toBe(false);
  });
  it("preserves Plan read-only surface and asks before Agent/auto writes", async () => {
    expect(build().readOnly.desktop_workspace_write).toBeUndefined();
    expect(requiresToolApproval("auto", "desktop_workspace_write", {})).toBe(
      true,
    );
    expect(requiresToolApproval("full", "desktop_workspace_write", {})).toBe(
      false,
    );
    const gate = jest.fn(async () => {
      throw new Error("Denied");
    });
    await expect(
      run(gateToolSet(build().all, gate), "desktop_workspace_write", {
        ...workingFile,
        content: "new",
        expectedVersion: "a".repeat(64),
        brief: "Update",
      }),
    ).rejects.toThrow("Denied");
    expect(mockRelay).not.toHaveBeenCalled();
  });
  it("hides file grants from chats that have no working-file binding", async () => {
    const result = await run(
      build(false).all,
      "desktop_workspace_list_grants",
      { brief: "List" },
    );
    expect(result).toEqual({ ok: true, grants: [] });
  });
  it.each([
    "desktop_workspace_read",
    "desktop_workspace_list",
    "desktop_workspace_write",
  ])(
    "denies a known file grant from an unbound chat using %s",
    async (tool) => {
      const result = await run(build(false).all, tool, {
        ...workingFile,
        content: "new",
        expectedVersion: "a".repeat(64),
        encoding: "utf8",
        brief: "Try known file",
      });
      expect(result.ok).toBe(false);
      expect(mockRelay.mock.calls.map(([args]) => args.operation)).toEqual([
        "list_grants",
      ]);
    },
  );
  it("keeps existing folder flow but sanitizes list metadata", async () => {
    mockRelay.mockImplementation(async ({ operation }) =>
      operation === "list_grants"
        ? [
            grant,
            {
              grantId: other,
              name: "workspace",
              kind: "directory",
              writable: true,
              grantedAt: 1,
              rootPath: "/Users/private/workspace",
            },
          ]
        : { relativePath: "folder/a.txt", size: 6 },
    );

    const result = await run(
      build(false).all,
      "desktop_workspace_list_grants",
      { brief: "List" },
    );
    expect(result.grants).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("rootPath");
    await run(build(false).all, "desktop_workspace_write", {
      grantId: other,
      relativePath: "folder/a.txt",
      content: "legacy",
      encoding: "utf8",
      brief: "Update",
    });
    expect(mockRelay).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "write_file",
        payload: {
          grantId: other,
          relativePath: "folder/a.txt",
          content: "legacy",
          encoding: "utf8",
        },
      }),
      expect.objectContaining({ serviceKey: "service" }),
    );
  });
  it("reports optimistic write conflicts without returning native path details", async () => {
    const { DesktopLocalAccessError } = jest.requireMock(
      "@/lib/desktop/local-access-relay",
    );
    mockRelay.mockImplementation(async ({ operation }) => {
      if (operation === "list_grants") return [grant];
      throw new DesktopLocalAccessError(
        "denied",
        "FILE_VERSION_CONFLICT: /Users/private/notes.md changed",
      );
    });
    const result = await run(build().all, "desktop_workspace_write", {
      ...workingFile,
      content: "new",
      expectedVersion: "a".repeat(64),
      brief: "Update",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "file_changed" },
    });
    expect(JSON.stringify(result)).not.toContain("/Users");
  });

  it("does not describe an unacknowledged write as a definite failed write", async () => {
    const { DesktopLocalAccessError } = jest.requireMock(
      "@/lib/desktop/local-access-relay",
    );
    mockRelay.mockImplementation(async ({ operation }) => {
      if (operation === "list_grants") return [grant];
      throw new DesktopLocalAccessError(
        "outcome_unknown",
        "/Users/private/notes.md may have changed",
      );
    });
    const result = await run(build().all, "desktop_workspace_write", {
      ...workingFile,
      content: "new",
      expectedVersion: "a".repeat(64),
      brief: "Update",
    });
    expect(result.error.code).toBe("outcome_unknown");
    expect(result.error.message).toMatch(/may already have completed/i);
    expect(JSON.stringify(result)).not.toContain("/Users");
  });

  it("does not disclose local paths from native error strings", async () => {
    mockRelay.mockRejectedValue(
      new Error("cannot read /Users/private/notes.md"),
    );
    const result = await run(build().all, "desktop_workspace_read", {
      ...workingFile,
      brief: "Read",
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("/Users");
  });
});
