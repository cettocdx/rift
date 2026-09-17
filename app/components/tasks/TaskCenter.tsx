"use client";

import { useMemo, useRef, useState } from "react";
import styles from "./TaskCenter.module.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Edit3,
  ExternalLink,
  History,
  ListTodo,
  Loader2,
  MoreHorizontal,
  Plus,
  Play,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { CODEX_NATIVE_UI_STYLE } from "@/app/components/page-shell/CodexPageShell";
import { hasPremiumAccess } from "@/lib/auth/premium-access";
import {
  filterTasks,
  fromLocalDateTimeValue,
  scheduleLabel,
  taskCounts,
  toLocalDateTimeValue,
  type TaskListItem,
  type TaskView,
} from "./task-center-utils";

type TaskId = Id<"tasks">;

type TaskRecord = Omit<TaskListItem, "_id"> & { _id: TaskId };

interface TaskFormState {
  title: string;
  prompt: string;
  purpose: "security" | "app";
  scheduleType: "manual" | "once" | "recurring";
  scheduledFor: string;
  scheduleExpression: string;
  timezone: string;
}

const EMPTY_FORM: TaskFormState = {
  title: "",
  prompt: "",
  purpose: "app",
  scheduleType: "manual",
  scheduledFor: "",
  scheduleExpression: "",
  timezone: "",
};

const EMPTY_TASKS: TaskRecord[] = [];

const VIEW_META: ReadonlyArray<{
  id: TaskView;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "scheduled", label: "Scheduled" },
  { id: "completed", label: "Completed" },
];

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string | undefined;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function taskToForm(task: TaskRecord): TaskFormState {
  return {
    title: task.title,
    prompt: task.prompt,
    purpose: task.purpose ?? "security",
    scheduleType: task.schedule_type,
    scheduledFor: toLocalDateTimeValue(task.scheduled_for, task.timezone),
    scheduleExpression: task.schedule_expression ?? "",
    timezone: task.timezone ?? browserTimezone(),
  };
}

function TaskListSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-lg border border-border/80 bg-card/[0.12]"
      role="status"
      aria-label="Loading tasks"
    >
      <span className="sr-only">Loading tasks…</span>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          aria-hidden
          // Mirrors TaskRow's grid, height and padding so the list does not
          // jump when real rows replace the placeholder.
          className="grid min-h-[78px] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border/70 px-3.5 py-3 last:border-b-0"
        >
          <Skeleton className="mt-[3px] size-4 shrink-0 rounded-[3px]" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3.5 w-52 max-w-full" />
            <Skeleton className="h-3 w-[420px] max-w-[85%]" />
            <Skeleton className="h-3 w-40 max-w-[45%]" />
          </div>
          <Skeleton className="size-6 rounded-md" />
        </div>
      ))}
    </div>
  );
}

function EmptyTasks({ view }: { view: TaskView }) {
  // The page header keeps a Create task button in view behind this panel, so
  // the copy points at that one control instead of repeating it here.
  const copy =
    view === "scheduled"
      ? {
          title: "No scheduled tasks",
          body: "Give an open task a one-time or recurring schedule and it appears here.",
        }
      : view === "completed"
        ? {
            title: "No completed tasks",
            body: "Finished tasks stay here until you delete them.",
          }
        : {
            title: "No tasks yet",
            body: "Use Create task to save an instruction, then give it a schedule to run it automatically.",
          };

  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-card/[0.1] px-6 py-10 text-center">
      <div className="mb-3 text-muted-foreground">
        <ListTodo className="size-[18px]" strokeWidth={1.6} />
      </div>
      <h2 className="text-ui-section font-medium text-foreground">
        {copy.title}
      </h2>
      <p className="mt-1.5 max-w-sm text-ui leading-5 text-muted-foreground">
        {copy.body}
      </p>
    </div>
  );
}

function TaskFormDialog({
  open,
  task,
  onOpenChange,
  onSubmit,
  canSchedule,
  restoreFocus,
}: {
  open: boolean;
  task: TaskRecord | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (state: TaskFormState) => Promise<boolean>;
  canSchedule: boolean;
  restoreFocus: () => void;
}) {
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForOpen = () => {
    setForm(
      task ? taskToForm(task) : { ...EMPTY_FORM, timezone: browserTimezone() },
    );
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) resetForOpen();
    onOpenChange(nextOpen);
  };

  const canSubmit =
    form.title.trim().length > 0 &&
    form.prompt.trim().length > 0 &&
    (form.scheduleType === "manual" || canSchedule) &&
    form.purpose !== "security" &&
    (form.scheduleType !== "once" || form.scheduledFor.length > 0) &&
    (form.scheduleType !== "recurring" ||
      form.scheduleExpression.trim().length > 0);

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const ok = await onSubmit(form);
      if (ok) onOpenChange(false);
    } catch (submitError) {
      setError(getErrorMessage(submitError, "Task could not be saved"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`${styles.dialog} max-h-[calc(100dvh-2rem)] max-w-[560px] overflow-y-auto p-5 sm:p-6`}
        onOpenAutoFocus={resetForOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
        aria-busy={submitting}
      >
        <DialogHeader>
          <DialogTitle className="text-ui-section">
            {task ? "Edit task" : "Create task"}
          </DialogTitle>
          <DialogDescription className="text-ui leading-5">
            Save instructions and let RIFT run them in a new, durable chat.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="task-title" className="text-ui-nav">
              Name
            </Label>
            <Input
              id="task-title"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              maxLength={120}
              placeholder="Review dependency updates"
              autoComplete="off"
              className="h-9 text-ui"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-mode" className="text-ui-nav">
              Mode
            </Label>
            <Select
              value={form.purpose}
              onValueChange={(value: TaskFormState["purpose"]) =>
                setForm((current) => ({ ...current, purpose: value }))
              }
            >
              <SelectTrigger id="task-mode" className="h-9 text-ui">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="app">Build</SelectItem>
                <SelectItem value="security" disabled>
                  Hack Workbench · open separately
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.purpose === "security" ? (
            <div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2.5 text-ui leading-5 text-muted-foreground">
              This legacy task cannot run as a normal chat. Switch it to Build,
              or open the dedicated premium{" "}
              <Link
                href="/hack"
                className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
              >
                Hack Workbench
              </Link>
              .
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="task-prompt" className="text-ui-nav">
              Instructions
            </Label>
            <Textarea
              id="task-prompt"
              value={form.prompt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  prompt: event.target.value,
                }))
              }
              maxLength={8000}
              placeholder="Describe the work, constraints, and expected result."
              className="min-h-28 resize-y text-ui leading-5"
            />
            <div className="text-right font-mono text-ui-caption text-muted-foreground/70">
              {form.prompt.length}/8000
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-schedule" className="text-ui-nav">
              Schedule
            </Label>
            <Select
              value={form.scheduleType}
              onValueChange={(value: TaskFormState["scheduleType"]) =>
                setForm((current) => ({ ...current, scheduleType: value }))
              }
            >
              <SelectTrigger id="task-schedule" className="h-9 text-ui">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="once" disabled={!canSchedule}>
                  One time{canSchedule ? "" : " · Pro"}
                </SelectItem>
                <SelectItem value="recurring" disabled={!canSchedule}>
                  Recurring{canSchedule ? "" : " · Pro"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.scheduleType === "once" ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
              <div className="grid gap-2">
                <Label htmlFor="task-scheduled-for" className="text-ui-label">
                  Date and time
                </Label>
                <Input
                  id="task-scheduled-for"
                  type="datetime-local"
                  value={form.scheduledFor}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      scheduledFor: event.target.value,
                    }))
                  }
                  className="h-9 text-ui"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="task-timezone-once" className="text-ui-label">
                  Time zone
                </Label>
                <Input
                  id="task-timezone-once"
                  value={form.timezone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      timezone: event.target.value,
                    }))
                  }
                  maxLength={80}
                  placeholder="Europe/Istanbul"
                  className="h-9 font-mono text-ui-label"
                />
              </div>
            </div>
          ) : null}

          {form.scheduleType === "recurring" ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
              <div className="grid gap-2">
                <Label
                  htmlFor="task-schedule-expression"
                  className="text-ui-label"
                >
                  Recurrence
                </Label>
                <Input
                  id="task-schedule-expression"
                  value={form.scheduleExpression}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      scheduleExpression: event.target.value,
                    }))
                  }
                  maxLength={240}
                  placeholder="0 9 * * 1-5"
                  className="h-9 font-mono text-ui-label"
                />
              </div>
              <div className="grid gap-2">
                <Label
                  htmlFor="task-timezone-recurring"
                  className="text-ui-label"
                >
                  Time zone
                </Label>
                <Input
                  id="task-timezone-recurring"
                  value={form.timezone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      timezone: event.target.value,
                    }))
                  }
                  maxLength={80}
                  placeholder="Europe/Istanbul"
                  className="h-9 font-mono text-ui-label"
                />
              </div>
            </div>
          ) : null}

          {form.scheduleType !== "manual" ? (
            <div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2.5 text-ui leading-5 text-muted-foreground">
              {form.scheduleType === "recurring"
                ? "RIFT runs this task automatically in a new chat. Use a five-field cron expression or a shortcut such as “Weekdays at 09:00”. Recurring runs are limited to once per hour and are not attached to a project."
                : "RIFT runs this task once at the selected time in a new chat. This task is not attached to a project."}{" "}
              Editing, pausing, completing, or deleting the task cancels queued
              runs; a run already in progress finishes.
            </div>
          ) : null}

          {!canSchedule ? (
            <div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2.5 text-ui leading-5 text-muted-foreground">
              Manual tasks are available on every plan. Automatic one-time and
              recurring runs require RIFT Pro or Max. Security work opens in the
              dedicated Hack Workbench.
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-ui-label text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="h-9 text-ui"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit || submitting}
            className="h-9 text-ui"
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {task ? "Save changes" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskRow({
  task,
  busy,
  onEdit,
  onToggle,
  onComplete,
  onDelete,
  canSchedule,
  onRun,
}: {
  task: TaskRecord;
  busy: boolean;
  onEdit: (trigger: HTMLButtonElement | null) => void;
  onToggle: (enabled: boolean) => void;
  onComplete: (completed: boolean) => void;
  onDelete: () => void;
  onRun: () => void;
  canSchedule: boolean;
}) {
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const completed = task.status === "completed";
  const scheduled = task.schedule_type !== "manual";
  const legacySecurity = (task.purpose ?? "security") === "security";
  // `enabled` is the task's own pause flag and outlives its schedule:
  // updateTask in convex/tasks.ts holds a paused task inactive even after an
  // edit gives it a date or a cron, so a manual row's flag still decides
  // whether that later schedule ever runs. Completing a task forces the flag
  // false and setTaskEnabled refuses to raise it again until the task is
  // reopened, which leaves a finished row nothing to toggle.
  const showRunToggle = !completed;

  return (
    <article className="group grid min-h-[78px] grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 border-b border-border/70 px-3.5 py-3 transition-colors duration-(--duration-hover) last:border-b-0 hover:bg-accent/25">
      <div
        className={`mt-[3px] flex size-4 shrink-0 items-center justify-center ${
          completed ? "text-muted-foreground/60" : "text-muted-foreground"
        }`}
        aria-hidden
      >
        {completed ? (
          <CheckCircle2 className="size-4" strokeWidth={1.7} />
        ) : scheduled ? (
          <CalendarClock className="size-4" strokeWidth={1.7} />
        ) : (
          <ListTodo className="size-4" strokeWidth={1.7} />
        )}
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2
            className={`truncate text-ui font-medium ${
              completed ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {task.title}
          </h2>
          {completed ? (
            // The row's status icon is aria-hidden, so this text is the only
            // announced marker separating a finished task from an open one.
            <span className="shrink-0 text-ui-label text-muted-foreground">
              Completed
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 max-w-3xl text-ui-label leading-[18px] text-muted-foreground">
          {task.prompt}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-caption text-muted-foreground/75">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Clock3 className="size-3 shrink-0" strokeWidth={1.7} />
            <span className="truncate">{scheduleLabel(task)}</span>
          </span>
          {scheduled && task.next_run_at ? (
            <span>
              next{" "}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(task.next_run_at))}
            </span>
          ) : null}
          {legacySecurity ? <span>Hack Workbench</span> : null}
        </div>
        {task.schedule_error ? (
          <p className="mt-1.5 text-ui-nav text-destructive">
            {task.schedule_error}
          </p>
        ) : null}
      </div>

      <div className="flex items-start gap-1.5">
        {busy ? (
          <Loader2
            className="mt-1.5 size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-label="Updating task"
          />
        ) : showRunToggle ? (
          <Switch
            checked={task.enabled}
            onCheckedChange={onToggle}
            // The two cases setTaskEnabled rejects: raising the flag on a
            // legacy security task, and raising it on a scheduled task without
            // a paid plan. Resuming a manual task works on every plan.
            disabled={
              (legacySecurity && !task.enabled) ||
              (scheduled && !canSchedule && !task.enabled)
            }
            aria-label={`${task.enabled ? "Pause" : "Resume"} ${scheduled ? "automatic runs for " : ""}${task.title}`}
            title={
              legacySecurity
                ? "Legacy security tasks must be run from Hack Workbench"
                : scheduled
                  ? "Pause or resume automatic runs"
                  : "A paused task stays inactive when you give it a schedule"
            }
            className="mt-1"
          />
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={actionsTrigger}
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`More actions for ${task.title}`}
              disabled={busy}
              className="text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {!completed && !scheduled && !legacySecurity && task.enabled && (
              <DropdownMenuItem onSelect={onRun} disabled={busy}>
                <Play /> Run now
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onEdit(actionsTrigger.current)}>
              <Edit3 /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onComplete(!completed)}>
              {completed ? <RefreshCcw /> : <Check />}
              {completed ? "Reopen" : "Mark complete"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

export function TaskCenter() {
  const router = useRouter();
  const { subscription } = useGlobalState();
  const canSchedule = hasPremiumAccess(subscription);
  const tasks = useQuery(api.tasks.listForUser, {});
  const runs = useQuery(api.tasks.listRecentRuns, { limit: 10 });
  const createTask = useMutation(api.tasks.createTask);
  const updateTask = useMutation(api.tasks.updateTask);
  const setTaskEnabled = useMutation(api.tasks.setTaskEnabled);
  const setTaskCompleted = useMutation(api.tasks.setTaskCompleted);
  const removeTask = useMutation(api.tasks.removeTask);

  const [view, setView] = useState<TaskView>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskRecord | null>(null);
  const [busyId, setBusyId] = useState<TaskId | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const runRequestIds = useRef(new Map<TaskId, string>());
  const pendingRunsRef = useRef(new Set<TaskId>());
  const createTrigger = useRef<HTMLButtonElement>(null);
  const formReturnTarget = useRef<HTMLButtonElement | null>(null);
  const [pendingRunIds, setPendingRunIds] = useState<Set<TaskId>>(new Set());
  const [runNotice, setRunNotice] = useState<{
    title: string;
    state: string;
    chatId?: string;
    dispatchPending?: boolean;
  } | null>(null);

  const runTaskNow = async (task: TaskRecord) => {
    if (
      pendingRunsRef.current.has(task._id) ||
      !task.enabled ||
      task.status !== "open" ||
      task.schedule_type !== "manual" ||
      task.purpose !== "app"
    )
      return;
    pendingRunsRef.current.add(task._id);
    setPendingRunIds(new Set(pendingRunsRef.current));
    setPageError(null);
    setRunNotice(null);
    const requestId =
      runRequestIds.current.get(task._id) ?? crypto.randomUUID();
    runRequestIds.current.set(task._id, requestId);
    try {
      const response = await fetch("/api/tasks/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task._id, requestId }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "This task could not be started. Try Run now again.",
        );
      const states = ["queued", "running", "succeeded", "failed", "canceled"];
      if (!states.includes(result.state))
        throw new Error(
          "The run response was incomplete. Try Run now again to check the same request.",
        );
      const chatId =
        typeof result.chatId === "string" && result.chatId.length > 0
          ? result.chatId
          : undefined;
      runRequestIds.current.delete(task._id);
      setRunNotice({
        title: task.title,
        state: result.state,
        chatId,
        dispatchPending: result.dispatchPending === true,
      });
      if (chatId) router.push(`/c/${encodeURIComponent(chatId)}`);
    } catch (error) {
      // Keep the same key: a lost HTTP response may already have queued the run.
      setPageError(
        getErrorMessage(
          error,
          "Could not confirm the run. Try Run now again; the same request will be checked.",
        ),
      );
    } finally {
      pendingRunsRef.current.delete(task._id);
      setPendingRunIds(new Set(pendingRunsRef.current));
    }
  };

  const taskRows = (tasks ?? EMPTY_TASKS) as TaskRecord[];
  const counts = useMemo(() => taskCounts(taskRows), [taskRows]);
  const visibleTasks = useMemo(
    () => filterTasks(taskRows, view),
    [taskRows, view],
  );

  const openCreate = () => {
    formReturnTarget.current = createTrigger.current;
    setEditingTask(null);
    setFormOpen(true);
  };

  const openEdit = (task: TaskRecord, trigger: HTMLButtonElement | null) => {
    formReturnTarget.current = trigger;
    setEditingTask(task);
    setFormOpen(true);
  };

  const saveTask = async (form: TaskFormState): Promise<boolean> => {
    const scheduledFor = fromLocalDateTimeValue(
      form.scheduledFor,
      form.timezone,
    );
    const payload = {
      title: form.title,
      prompt: form.prompt,
      scheduleType: form.scheduleType,
      purpose: form.purpose,
      scheduledFor: form.scheduleType === "once" ? scheduledFor : undefined,
      scheduleExpression:
        form.scheduleType === "recurring" ? form.scheduleExpression : undefined,
      timezone: form.scheduleType === "manual" ? undefined : form.timezone,
    };
    const result = editingTask
      ? await updateTask({ id: editingTask._id, ...payload })
      : await createTask(payload);
    if (!result.success) {
      throw new Error(result.error ?? "Task could not be saved");
    }
    return true;
  };

  const runRowMutation = async (
    task: TaskRecord,
    action: () => Promise<{ success: boolean; error?: string }>,
    fallback: string,
  ) => {
    setBusyId(task._id);
    setPageError(null);
    try {
      const result = await action();
      if (!result.success) setPageError(result.error ?? fallback);
    } catch (error) {
      setPageError(getErrorMessage(error, fallback));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await runRowMutation(
      target,
      () => removeTask({ id: target._id }),
      "Task could not be deleted",
    );
  };

  return (
    <div
      id="tasks-main"
      // bg-background resolves to the active workspace appearance token, so
      // this scroll container paints the same surface as the shell around it.
      className="terminal-scrollbar h-full min-h-0 overflow-y-auto bg-background"
      aria-busy={tasks === undefined || runs === undefined}
      style={CODEX_NATIVE_UI_STYLE}
    >
      <div className="rift-page-frame rift-page-start shrink-0 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-ui-title font-medium tracking-[-0.012em] text-foreground">
              Tasks
            </h1>
            <p className="mt-1 max-w-2xl rift-page-description text-muted-foreground">
              Saved instructions, ready to run now or on a schedule. Bot tasks
              continue in their saved conversation.
            </p>
          </div>
          <Button
            ref={createTrigger}
            onClick={openCreate}
            size="sm"
            className={`${styles.touchTarget} h-8 rounded-md text-ui`}
          >
            <Plus className="size-3.5" />
            Create task
          </Button>
        </div>

        <div
          className="mt-5 flex w-fit items-center gap-0.5 rounded-lg border border-border/75 bg-card/[0.12] p-0.5"
          role="group"
          aria-label="Filter tasks"
        >
          {VIEW_META.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                aria-controls="task-list-panel"
                onClick={() => setView(item.id)}
                className={`${styles.touchTarget} rounded-md px-3 py-1.5 text-ui-label font-medium transition-colors duration-(--duration-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/60 ${
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                {item.label}
                <span className="ml-1.5 font-mono text-ui-caption text-muted-foreground">
                  {counts[item.id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="shrink-0">
        <div className="rift-page-frame pb-8 pt-3">
          {pageError ? (
            <div
              role="alert"
              className="mb-4 flex items-start justify-between gap-4 rounded-md border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-ui text-destructive"
            >
              <span>{pageError}</span>
              <button
                type="button"
                onClick={() => setPageError(null)}
                className="shrink-0 underline underline-offset-4"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {runNotice && (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2.5 text-ui text-muted-foreground"
            >
              <span>
                {runNotice.title}:{" "}
                {runNotice.state === "queued"
                  ? "run queued"
                  : runNotice.state === "running"
                    ? "run already in progress"
                    : `run ${runNotice.state}`}
                .
                {runNotice.dispatchPending
                  ? " Dispatch will retry automatically."
                  : ""}
              </span>
              {runNotice.chatId && (
                <Link
                  className="underline underline-offset-4"
                  href={`/c/${encodeURIComponent(runNotice.chatId)}`}
                >
                  Open conversation
                </Link>
              )}
            </div>
          )}
          <div id="task-list-panel">
            {tasks === undefined ? (
              <TaskListSkeleton />
            ) : visibleTasks.length === 0 ? (
              <EmptyTasks view={view} />
            ) : (
              <section
                aria-label={`${VIEW_META.find((item) => item.id === view)?.label ?? "All"} tasks`}
                className="overflow-hidden rounded-lg border border-border/80 bg-card/[0.12]"
              >
                {visibleTasks.map((task) => (
                  <TaskRow
                    key={task._id}
                    task={task}
                    busy={busyId === task._id || pendingRunIds.has(task._id)}
                    onRun={() => void runTaskNow(task)}
                    onEdit={(trigger) => openEdit(task, trigger)}
                    onToggle={(enabled) =>
                      void runRowMutation(
                        task,
                        () => setTaskEnabled({ id: task._id, enabled }),
                        "Task could not be updated",
                      )
                    }
                    onComplete={(completed) =>
                      void runRowMutation(
                        task,
                        () => setTaskCompleted({ id: task._id, completed }),
                        "Task could not be updated",
                      )
                    }
                    onDelete={() => setDeleteTarget(task)}
                    canSchedule={canSchedule}
                  />
                ))}
              </section>
            )}
          </div>

          <section className="mt-7" aria-labelledby="task-run-history-heading">
            <div className="mb-3 flex items-center gap-2">
              <History
                className="size-[15px] text-muted-foreground"
                strokeWidth={1.6}
              />
              <h2
                id="task-run-history-heading"
                className="text-ui font-medium text-foreground"
              >
                Run history
              </h2>
            </div>
            {runs === undefined ? (
              <Skeleton className="h-20 w-full rounded-md motion-reduce:animate-none" />
            ) : runs.length === 0 ? (
              <div className="rounded-lg border border-border/80 bg-card/[0.08] px-4 py-4 text-ui leading-5 text-muted-foreground">
                No runs yet. Every scheduled run lands here, including the ones
                that fail.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border/80 bg-card/[0.08]">
                {runs.map((run) => (
                  <div
                    key={run._id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border/70 px-4 py-3 text-ui last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">
                        {run.task_title}
                      </div>
                      <div className="mt-1 truncate font-mono text-ui-caption text-muted-foreground">
                        {run.run_id}
                      </div>
                      {run.error_message ? (
                        <div className="mt-1 line-clamp-2 text-destructive">
                          {run.error_message}
                        </div>
                      ) : null}
                      {run.chat_id ? (
                        <Link
                          href={`/c/${encodeURIComponent(run.chat_id)}`}
                          className="mt-1.5 inline-flex items-center gap-1 text-ui-label font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                        >
                          Open chat
                          <ExternalLink className="size-3" aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-ui-caption uppercase tracking-[0.06em] text-muted-foreground">
                        {run.status}
                      </div>
                      <time
                        dateTime={new Date(run.started_at).toISOString()}
                        className="mt-1 block text-ui-caption text-muted-foreground/75"
                      >
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(run.started_at))}
                      </time>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <TaskFormDialog
        restoreFocus={() => {
          // Saving or a live update can remove the edited row from this view.
          const target = formReturnTarget.current;
          (target?.isConnected && !target.disabled
            ? target
            : createTrigger.current
          )?.focus({ preventScroll: true });
        }}
        key={editingTask?._id ?? "create"}
        open={formOpen}
        task={editingTask}
        onOpenChange={(nextOpen) => {
          setFormOpen(nextOpen);
          if (!nextOpen) setEditingTask(null);
        }}
        onSubmit={saveTask}
        canSchedule={canSchedule}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `“${deleteTarget.title}” and its recorded run history will be permanently deleted.`
                : "This task and its recorded run history will be permanently deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="border border-destructive/40 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
