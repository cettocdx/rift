import {
  WORKBENCH_TERMINAL_REQUEST_HEADER,
  WORKBENCH_TERMINAL_REQUEST_HEADER_VALUE,
} from "./interactive-terminal-contract";

/**
 * Optional routing context for the browser Workbench. A chat id lets the
 * server restore the durable project binding; a project id is used only for a
 * not-yet-persisted chat. Both values are untrusted until the server resolves
 * them against the authenticated user.
 */
export type WorkbenchProjectRequestContext = {
  chatId?: string;
  projectId?: string;
};

export const WORKBENCH_CHAT_ID_HEADER = "X-RIFT-Workbench-Chat-Id";
export const WORKBENCH_PROJECT_ID_HEADER = "X-RIFT-Workbench-Project-Id";

export const STANDALONE_WORKBENCH_REQUEST_HEADERS = Object.freeze({
  [WORKBENCH_TERMINAL_REQUEST_HEADER]: WORKBENCH_TERMINAL_REQUEST_HEADER_VALUE,
});

export function createWorkbenchRequestHeaders(
  context: WorkbenchProjectRequestContext = {},
): Readonly<Record<string, string>> {
  return Object.freeze({
    ...STANDALONE_WORKBENCH_REQUEST_HEADERS,
    ...(context.chatId ? { [WORKBENCH_CHAT_ID_HEADER]: context.chatId } : {}),
    ...(context.projectId
      ? { [WORKBENCH_PROJECT_ID_HEADER]: context.projectId }
      : {}),
  });
}
