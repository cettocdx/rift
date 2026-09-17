export const DEFAULT_WORKBENCH_TERMINAL_CWD = "/home/user/workspace";
export const WORKBENCH_TERMINAL_SANDBOX_NAMESPACE = "workbench-cli-v2";
export const LEGACY_WORKBENCH_TERMINAL_SANDBOX_NAMESPACES = [
  "workbench-cli",
] as const;

export function workbenchTerminalSandboxUserId(userId: string) {
  return `${userId}:${WORKBENCH_TERMINAL_SANDBOX_NAMESPACE}`;
}

export function workbenchSandboxOwnerIds(userId: string) {
  return [
    userId,
    workbenchTerminalSandboxUserId(userId),
    ...LEGACY_WORKBENCH_TERMINAL_SANDBOX_NAMESPACES.map(
      (namespace) => `${userId}:${namespace}`,
    ),
  ];
}

export type WorkbenchTerminalResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
};
