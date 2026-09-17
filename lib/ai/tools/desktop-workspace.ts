import { captureRelayOrigin } from "@/lib/centrifugo/relay-origin";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  parseWorkingFileContext,
  type WorkingFileContext,
} from "@/lib/desktop/working-file-context";
import {
  DesktopLocalAccessError,
  requestDesktopLocalAccess,
  type DesktopWorkspaceEntryResult,
  type DesktopWorkspaceFileResult,
  type DesktopWorkspaceGrantResult,
} from "@/lib/desktop/local-access-relay";

const brief = z
  .string()
  .max(240)
  .describe("A one-sentence preamble describing this local desktop action");
const grantId = z.string().uuid().describe("Opaque workspace grant ID");
const relativePath = z
  .string()
  .max(4096)
  .describe("Path relative to the user-selected workspace folder");

function safeRelayError(error: unknown) {
  if (
    error instanceof DesktopLocalAccessError &&
    error.code === "outcome_unknown"
  ) {
    return {
      ok: false as const,
      error: {
        code: "outcome_unknown",
        message:
          "The local operation may already have completed, but its acknowledgement was lost. Read the current file or check the browser state before requesting another change; do not blindly repeat the action.",
      },
    };
  }
  if (
    error instanceof DesktopLocalAccessError &&
    error.message.startsWith("FILE_VERSION_CONFLICT:")
  ) {
    return {
      ok: false as const,
      error: {
        code: "file_changed",
        message:
          "The original file changed since it was read. Read it again and reconcile the new content before writing.",
      },
    };
  }
  return {
    ok: false as const,
    error: {
      code:
        error instanceof DesktopLocalAccessError ? error.code : "unavailable",
      message:
        "RIFT Desktop could not complete this file action. Check the selected access and read the file again before retrying a write.",
    },
  };
}

export function createDesktopWorkspaceToolSets(
  options: {
    userId: string;
    serviceKey: string;
    workingFile?: WorkingFileContext;
  },
  origin = captureRelayOrigin(options.serviceKey),
): { all: ToolSet; readOnly: ToolSet } {
  const selected = parseWorkingFileContext(options.workingFile);
  const scopedGrantId = selected ? z.literal(selected.grantId) : grantId;
  const scopedPath = selected ? z.literal(selected.relativePath) : relativePath;
  const version = z.string().regex(/^[a-f0-9]{64}$/);
  const relay = <T>(
    operation:
      | "list_grants"
      | "list_entries"
      | "read_file"
      | "write_file"
      | "open_visible_url",
    payload: Record<string, unknown> | undefined,
    signal?: AbortSignal,
  ) =>
    requestDesktopLocalAccess<T>(
      {
        userId: options.userId,
        serviceKey: options.serviceKey,
        operation,
        payload,
        timeoutMs: operation === "open_visible_url" ? 120_000 : 30_000,
        signal,
      },
      origin,
    );

  type Grant = DesktopWorkspaceGrantResult & {
    kind?: "file" | "directory";
    relativePath?: string;
  };
  const denied = () => {
    throw new DesktopLocalAccessError(
      "denied",
      "Selected file access is unavailable.",
    );
  };
  const assertTarget = (id: string, path: string, listing = false) => {
    if (
      selected &&
      (id !== selected.grantId ||
        (path !== selected.relativePath && !(listing && path === "")))
    )
      denied();
  };
  const getGrants = async (signal?: AbortSignal): Promise<Grant[]> => {
    const grants = await relay<Grant[]>("list_grants", undefined, signal);
    if (!Array.isArray(grants)) return denied();
    // Session folder grants keep their existing app-wide behavior. File grants
    // are capabilities for an explicitly selected chat request, never ambient
    // access available to every chat on the same account.
    if (!selected) return grants.filter((grant) => grant.kind !== "file");
    const grant = grants.find((item) => item.grantId === selected.grantId);
    if (
      !grant ||
      grant.kind !== "file" ||
      grant.name !== selected.name ||
      grant.relativePath !== selected.relativePath
    )
      return denied();
    return [grant];
  };
  const assertNativeTarget = async (
    id: string,
    signal?: AbortSignal,
    writable = false,
  ) => {
    const grant = (await getGrants(signal)).find((item) => item.grantId === id);
    if (!grant) return denied();
    if (writable && grant.writable !== true) denied();
  };
  const sanitizedGrant = (grant: Grant) => ({
    grantId: grant.grantId,
    name: grant.name,
    writable: grant.writable,
    grantedAt: grant.grantedAt,
    ...(grant.kind ? { kind: grant.kind } : {}),
    ...(grant.relativePath ? { relativePath: grant.relativePath } : {}),
  });

  const listGrants = tool({
    description:
      "List the user-approved desktop grants available to this request. A selected PC file restricts this list to that exact original file. Host paths are never returned.",
    inputSchema: z.object({ brief }),
    execute: async (_input, { abortSignal }) => {
      try {
        return {
          ok: true,
          grants: (await getGrants(abortSignal)).map(sanitizedGrant),
        };
      } catch (error) {
        return safeRelayError(error);
      }
    },
  });

  const listEntries = tool({
    description:
      "List files and folders inside a user-approved RIFT Desktop workspace. Paths must be relative to the selected folder; symbolic-link escapes are blocked natively.",
    inputSchema: z.object({
      grantId: scopedGrantId,
      relativePath: (selected
        ? z.union([z.literal(""), scopedPath])
        : relativePath
      )
        .optional()
        .default(""),
      brief,
    }),
    execute: async ({ grantId, relativePath }, { abortSignal }) => {
      try {
        assertTarget(grantId, relativePath, true);
        if (selected) {
          await assertNativeTarget(grantId, abortSignal);
          return {
            ok: true,
            entries: [
              {
                name: selected.name,
                relativePath: selected.relativePath,
                kind: "file",
                size: null,
              },
            ],
          };
        }
        await assertNativeTarget(grantId, abortSignal);
        return {
          ok: true,
          entries: await relay<DesktopWorkspaceEntryResult[]>(
            "list_entries",
            { grantId, relativePath },
            abortSignal,
          ),
        };
      } catch (error) {
        return safeRelayError(error);
      }
    },
  });

  const readFile = tool({
    description:
      "Read one file inside a user-approved RIFT Desktop workspace. This cannot read absolute paths or files outside the selected folder.",
    inputSchema: z.object({
      grantId: scopedGrantId,
      relativePath: scopedPath,
      brief,
    }),
    execute: async ({ grantId, relativePath }, { abortSignal }) => {
      try {
        assertTarget(grantId, relativePath);
        await assertNativeTarget(grantId, abortSignal);
        return {
          ok: true,
          file: await relay<DesktopWorkspaceFileResult>(
            "read_file",
            { grantId, relativePath },
            abortSignal,
          ),
        };
      } catch (error) {
        return safeRelayError(error);
      }
    },
  });

  const writeFile = tool({
    description:
      "Create or replace a file in a writable native grant. For a selected PC file, this changes the original and requires expectedVersion from the latest desktop_workspace_read result. Conflicts require a fresh read, never a blind overwrite.",
    inputSchema: z.object({
      grantId: scopedGrantId,
      relativePath: scopedPath,
      content: z.string().max(512 * 1024),
      encoding: z.enum(["utf8", "base64"]).optional().default("utf8"),
      expectedVersion: selected ? version : version.optional(),
      brief,
    }),
    execute: async (
      { grantId, relativePath, content, encoding, expectedVersion },
      { abortSignal },
    ) => {
      try {
        assertTarget(grantId, relativePath);
        if (selected && !/^[a-f0-9]{64}$/.test(expectedVersion ?? "")) denied();
        await assertNativeTarget(grantId, abortSignal, true);
        return {
          ok: true,
          file: await relay<{
            relativePath: string;
            size: number;
            version?: string;
          }>(
            "write_file",
            {
              grantId,
              relativePath,
              content,
              encoding,
              ...(expectedVersion !== undefined ? { expectedVersion } : {}),
            },
            abortSignal,
          ),
        };
      } catch (error) {
        return safeRelayError(error);
      }
    },
  });

  const openBrowserPage = tool({
    description:
      "Open an HTTP(S) URL in the user's connected Mac browser, only when the task explicitly calls for that desktop action. This does not open a page on the phone or inspect a website. For public-page research use browse_url; for cloud app testing use the sandbox browser, then verify_app and expose_preview. RIFT Desktop may request native confirmation and does not attach to the user's browser profile.",
    inputSchema: z.object({
      url: z.string().url().max(4096),
      brief,
    }),
    execute: async ({ url }, { abortSignal }) => {
      try {
        return {
          ok: true,
          ...(await relay<{ opened: boolean }>(
            "open_visible_url",
            { url },
            abortSignal,
          )),
        };
      } catch (error) {
        return safeRelayError(error);
      }
    },
  });

  const readOnly: ToolSet = {
    desktop_workspace_list_grants: listGrants,
    desktop_workspace_list: listEntries,
    desktop_workspace_read: readFile,
  };
  return {
    readOnly,
    all: {
      ...readOnly,
      desktop_workspace_write: writeFile,
      open_browser_page: openBrowserPage,
    },
  };
}
