import {
  isChatPurpose,
  isReasoningEffort,
  isSelectedModel,
  type ChatPurpose,
  type ReasoningEffort,
  type SelectedModel,
  type Todo,
} from "@/types/chat";
import { parseApprovalMode, type ApprovalMode } from "@/lib/ai/approval/policy";
import {
  parseWorkingFileContext,
  type WorkingFileContext,
} from "@/lib/desktop/working-file-context";
import {
  getActiveGoalForModel,
  type ModelActiveGoal,
} from "@/lib/api/active-goal-context";

/** The original run's request settings, not its credentials, transcript, or worker envelope. */
export type AgentResumeRequestContext = {
  mode: "agent";
  purpose: ChatPurpose;
  temporary: boolean;
  approvalMode: ApprovalMode;
  sandboxPreference: string;
  selectedModel?: SelectedModel;
  reasoningEffort?: ReasoningEffort;
  projectId?: string;
  workingFile?: WorkingFileContext;
  activeGoal?: ModelActiveGoal;
  todos: Todo[];
  /** Bound assessment scope, restored only for security runs. */
  scope?: string;
  /** Owner-bound durable request identity for exact assessment cancellation. */
  dispatchId?: string;
};

export function getAgentResumeRequestContext(
  payload: Record<string, unknown>,
): AgentResumeRequestContext {
  const todos: Todo[] = Array.isArray(payload.baseTodos)
    ? payload.baseTodos.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const todo = value as Record<string, unknown>;
        if (
          typeof todo.id !== "string" ||
          typeof todo.content !== "string" ||
          (todo.status !== "pending" &&
            todo.status !== "in_progress" &&
            todo.status !== "completed" &&
            todo.status !== "cancelled")
        )
          return [];
        return [
          {
            id: todo.id,
            content: todo.content,
            status: todo.status,
            ...(typeof todo.sourceMessageId === "string"
              ? { sourceMessageId: todo.sourceMessageId }
              : {}),
          },
        ];
      })
    : [];
  const context: AgentResumeRequestContext = {
    mode: "agent",
    purpose:
      typeof payload.purpose === "string" && isChatPurpose(payload.purpose)
        ? payload.purpose
        : "security",
    temporary: payload.temporary === true,
    approvalMode: parseApprovalMode(payload.approvalMode),
    sandboxPreference:
      typeof payload.sandboxPreference === "string"
        ? payload.sandboxPreference
        : "e2b",
    todos,
  };
  if (
    typeof payload.selectedModel === "string" &&
    isSelectedModel(payload.selectedModel)
  )
    context.selectedModel = payload.selectedModel;
  if (isReasoningEffort(payload.reasoningEffort))
    context.reasoningEffort = payload.reasoningEffort;
  if (typeof payload.projectId === "string")
    context.projectId = payload.projectId;
  const workingFile = parseWorkingFileContext(payload.workingFile);
  if (workingFile) context.workingFile = workingFile;
  const activeGoal = getActiveGoalForModel(payload.activeGoal);
  if (activeGoal) context.activeGoal = activeGoal;
  if (
    context.purpose === "security" &&
    typeof payload.scope === "string" &&
    payload.scope.length <= 2048
  )
    context.scope = payload.scope.trim();
  if (
    context.purpose === "security" &&
    typeof payload.dispatchId === "string" &&
    payload.dispatchId.length > 0 &&
    payload.dispatchId.length <= 200 &&
    payload.dispatchId.trim() === payload.dispatchId
  )
    context.dispatchId = payload.dispatchId;
  return context;
}
