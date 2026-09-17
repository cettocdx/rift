import { createHash } from "node:crypto";
import { posix } from "node:path";

export const WORKBENCH_ROOT = "/home/user";
export const MAX_EDITABLE_FILE_BYTES = 1024 * 1024;
export const MAX_WORKSPACE_PATH_LENGTH = 1024;

const BLOCKED_HOME_SEGMENTS = new Set([
  ".aws",
  ".cache",
  ".config",
  ".docker",
  ".gnupg",
  ".local",
  ".npm",
  ".ssh",
]);

const BLOCKED_HOME_ENTRY_NAMES = new Set([
  "agent-transcripts",
  "terminal_full_output",
  "go",
  "SecLists",
]);

const ALLOWED_HOME_DOT_ENTRIES = new Set([
  ".editorconfig",
  ".eslintignore",
  ".eslintrc",
  ".gitignore",
  ".github",
  ".prettierignore",
  ".prettierrc",
  ".vscode",
  ".env.example",
  ".env.sample",
  ".env.template",
]);

const BLOCKED_DIRECTORY_NAMES = new Set([".git", ".next", "node_modules"]);

const BLOCKED_FILE_NAMES = new Set([
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
]);

export class WorkbenchPathError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_path"
      | "path_outside_workspace"
      | "sensitive_path",
  ) {
    super(message);
    this.name = "WorkbenchPathError";
  }
}

export function normalizeWorkspacePath(input: string | null | undefined) {
  const raw = input ?? "";
  if (raw.length > MAX_WORKSPACE_PATH_LENGTH) {
    throw new WorkbenchPathError(
      "The workspace path is too long.",
      "invalid_path",
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    throw new WorkbenchPathError(
      "The path contains invalid characters.",
      "invalid_path",
    );
  }
  if (raw.includes("\\")) {
    throw new WorkbenchPathError(
      "Workspace paths must use POSIX separators.",
      "invalid_path",
    );
  }
  if (raw.startsWith("/")) {
    throw new WorkbenchPathError(
      "Workspace paths must be relative to the sandbox home.",
      "path_outside_workspace",
    );
  }

  const normalized = posix.normalize(raw || ".");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new WorkbenchPathError(
      "The path leaves the workspace root.",
      "path_outside_workspace",
    );
  }

  const relativePath =
    normalized === "." ? "" : normalized.replace(/^\.\//, "");
  assertWorkspacePathAllowed(relativePath);
  return relativePath;
}

export function assertWorkspacePathAllowed(relativePath: string) {
  if (!relativePath) return;
  const segments = relativePath.split("/").filter(Boolean);
  const firstSegment = segments[0];
  const fileName = segments.at(-1);
  const containsBlockedDirectory = segments.some((segment) =>
    BLOCKED_DIRECTORY_NAMES.has(segment),
  );
  const isProtectedEnvFile =
    Boolean(fileName?.startsWith(".env")) &&
    ![".env.example", ".env.sample", ".env.template"].includes(fileName ?? "");
  const isBlockedHomeEntry =
    Boolean(firstSegment) &&
    (BLOCKED_HOME_ENTRY_NAMES.has(firstSegment ?? "") ||
      (firstSegment?.startsWith(".") &&
        !ALLOWED_HOME_DOT_ENTRIES.has(firstSegment)));

  if (
    (firstSegment ? BLOCKED_HOME_SEGMENTS.has(firstSegment) : false) ||
    isBlockedHomeEntry ||
    containsBlockedDirectory ||
    isProtectedEnvFile ||
    (fileName && BLOCKED_FILE_NAMES.has(fileName))
  ) {
    throw new WorkbenchPathError(
      "This protected sandbox path is not available in Workbench.",
      "sensitive_path",
    );
  }
}

export function isWorkspaceEntryVisible(parentPath: string, name: string) {
  try {
    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    normalizeWorkspacePath(relativePath);
    return true;
  } catch (error) {
    if (error instanceof WorkbenchPathError) return false;
    throw error;
  }
}

export function absoluteWorkspacePath(relativePath: string) {
  const normalized = normalizeWorkspacePath(relativePath);
  return normalized ? posix.join(WORKBENCH_ROOT, normalized) : WORKBENCH_ROOT;
}

export function relativeWorkspacePath(absolutePath: string) {
  const relativePath = posix.relative(
    WORKBENCH_ROOT,
    posix.normalize(absolutePath),
  );
  return normalizeWorkspacePath(relativePath);
}

export function workspaceRevision(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex");
}
