"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { extractAllSidebarContent } from "@/lib/utils/sidebar-utils";
import {
  isSidebarTerminal,
  type ChatMessage,
  type SidebarTerminal,
} from "@/types/chat";
import { useWorkbench } from "./WorkbenchProvider";

export type WorkbenchTerminalActivity = {
  chatId: string;
  terminal: SidebarTerminal | null;
};

export type WorkbenchInteractiveTerminalConnection =
  | "starting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "restarting"
  | "exited"
  | "error";

type WorkbenchActivityState = {
  chatId: string | null;
  terminal: SidebarTerminal | null;
  interactiveTerminal: WorkbenchInteractiveTerminalConnection;
};

type WorkbenchActivityPublisher = {
  publishTerminalActivity: (activity: WorkbenchTerminalActivity) => void;
  clearTerminalActivity: (chatId?: string) => void;
  publishInteractiveTerminalConnection: (
    connection: WorkbenchInteractiveTerminalConnection,
  ) => void;
};

const initialActivity: WorkbenchActivityState = {
  chatId: null,
  terminal: null,
  interactiveTerminal: "starting",
};

const WorkbenchActivityStateContext =
  createContext<WorkbenchActivityState | null>(null);
const WorkbenchActivityPublisherContext =
  createContext<WorkbenchActivityPublisher | null>(null);

function areTerminalInputsEqual(
  left: SidebarTerminal["input"],
  right: SidebarTerminal["input"],
) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }

  return true;
}

function areTerminalsEqual(
  left: SidebarTerminal | null,
  right: SidebarTerminal | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;

  return (
    left.toolCallId === right.toolCallId &&
    left.command === right.command &&
    left.output === right.output &&
    left.isExecuting === right.isExecuting &&
    left.isBackground === right.isBackground &&
    left.isInteractive === right.isInteractive &&
    left.pid === right.pid &&
    left.session === right.session &&
    left.shellAction === right.shellAction &&
    areTerminalInputsEqual(left.input, right.input) &&
    left.rawBytes === right.rawBytes
  );
}

function getLatestTerminal(messages: ChatMessage[]) {
  const sidebarContent = extractAllSidebarContent(messages);

  for (let index = sidebarContent.length - 1; index >= 0; index -= 1) {
    const content = sidebarContent[index];
    if (isSidebarTerminal(content)) return content;
  }

  return null;
}

export function WorkbenchActivityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activity, setActivity] =
    useState<WorkbenchActivityState>(initialActivity);

  const publishTerminalActivity = useCallback(
    ({ chatId, terminal }: WorkbenchTerminalActivity) => {
      setActivity((current) => {
        if (
          current.chatId === chatId &&
          areTerminalsEqual(current.terminal, terminal)
        ) {
          return current;
        }
        return { ...current, chatId, terminal };
      });
    },
    [],
  );

  const clearTerminalActivity = useCallback((chatId?: string) => {
    setActivity((current) => {
      if (chatId && current.chatId !== chatId) return current;
      if (!current.chatId && !current.terminal) return current;
      return { ...current, chatId: null, terminal: null };
    });
  }, []);

  const publishInteractiveTerminalConnection = useCallback(
    (interactiveTerminal: WorkbenchInteractiveTerminalConnection) => {
      setActivity((current) =>
        current.interactiveTerminal === interactiveTerminal
          ? current
          : { ...current, interactiveTerminal },
      );
    },
    [],
  );

  const publisher = useMemo(
    () => ({
      publishTerminalActivity,
      clearTerminalActivity,
      publishInteractiveTerminalConnection,
    }),
    [
      publishTerminalActivity,
      clearTerminalActivity,
      publishInteractiveTerminalConnection,
    ],
  );

  return (
    <WorkbenchActivityPublisherContext value={publisher}>
      <WorkbenchActivityStateContext value={activity}>
        {children}
      </WorkbenchActivityStateContext>
    </WorkbenchActivityPublisherContext>
  );
}

export function useWorkbenchActivity() {
  const activity = use(WorkbenchActivityStateContext);
  if (!activity) {
    throw new Error(
      "useWorkbenchActivity must be used within a WorkbenchActivityProvider",
    );
  }
  return activity;
}

export function useOptionalWorkbenchActivityPublisher() {
  return use(WorkbenchActivityPublisherContext);
}

/**
 * Renderless bridge for the chat runtime. Mount it inside chat.tsx with the
 * authoritative message stream; outside the Cursor workbench it is a no-op.
 * Terminal chunks update only activity subscribers, so Monaco and the file
 * provider do not rerender for streaming output.
 */
export function WorkbenchTerminalActivityBridge({
  chatId,
  messages,
}: {
  chatId: string;
  messages: ChatMessage[];
}) {
  const publisher = useOptionalWorkbenchActivityPublisher();
  const terminal = useMemo(() => getLatestTerminal(messages), [messages]);

  useEffect(() => {
    publisher?.publishTerminalActivity({ chatId, terminal });
  }, [publisher, chatId, terminal]);

  useEffect(
    () => () => publisher?.clearTerminalActivity(chatId),
    [publisher, chatId],
  );

  return null;
}

/** Opens the panel once for each chat/tool invocation, not for every chunk. */
export function WorkbenchActivityAutoOpen() {
  const { chatId, terminal } = useWorkbenchActivity();
  const { actions } = useWorkbench();
  const openBottomPanel = actions.openBottomPanel;
  const lastOpenedActivityRef = useRef<string | null>(null);
  const activityKey =
    chatId && terminal ? `${chatId}:${terminal.toolCallId}` : null;

  useEffect(() => {
    if (!activityKey || lastOpenedActivityRef.current === activityKey) return;
    lastOpenedActivityRef.current = activityKey;
    openBottomPanel();
  }, [activityKey, openBottomPanel]);

  return null;
}
