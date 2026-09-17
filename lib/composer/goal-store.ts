export const GOAL_OBJECTIVE_MAX_LENGTH = 4_000;
export const GOAL_STORAGE_VERSION = 1 as const;
export const GOAL_STORAGE_KEY_PREFIX = "rift:task-goal";

export type GoalStatus = "active" | "paused";

export type TaskGoal = Readonly<{
  version: typeof GOAL_STORAGE_VERSION;
  taskId: string;
  objective: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
}>;

/**
 * The deliberately small storage contract keeps the goal state usable outside
 * React and lets callers provide localStorage, a desktop bridge, or a test
 * double. TaskGoalStore catches adapter failures at the boundary.
 */
export interface GoalStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type BrowserStorageLike = Pick<
  GoalStorageAdapter,
  "getItem" | "setItem" | "removeItem"
>;

export type BrowserStorageProvider = () => BrowserStorageLike | null;

export type GoalStoreErrorCode =
  | "invalid_task_id"
  | "empty_objective"
  | "objective_too_long"
  | "not_found"
  | "storage_unavailable";

export type GoalStoreResult =
  | Readonly<{
      ok: true;
      goal: TaskGoal | null;
      changed: boolean;
    }>
  | Readonly<{
      ok: false;
      error: GoalStoreErrorCode;
      message: string;
    }>;

export type GoalCommand =
  | Readonly<{ action: "view" }>
  | Readonly<{ action: "set"; objective: string }>
  | Readonly<{ action: "edit"; objective: string }>
  | Readonly<{ action: "pause" }>
  | Readonly<{ action: "resume" }>
  | Readonly<{ action: "clear" }>;

export type GoalCommandParseResult =
  | Readonly<{ kind: "command"; command: GoalCommand }>
  | Readonly<{
      kind: "needs_input";
      action: "edit";
      message: string;
    }>
  | Readonly<{
      kind: "invalid";
      reason: "objective_too_long" | "unexpected_arguments";
      message: string;
    }>
  | Readonly<{ kind: "not_goal_command" }>;

export type GoalStoreOptions = Readonly<{
  now?: () => number;
  keyPrefix?: string;
}>;

type ObjectiveValidation =
  | Readonly<{ ok: true; objective: string }>
  | Readonly<{
      ok: false;
      error: "empty_objective" | "objective_too_long";
      message: string;
    }>;

const OBJECTIVE_REQUIRED_MESSAGE = "Goal objective cannot be empty.";
const OBJECTIVE_TOO_LONG_MESSAGE = `Goal objective cannot exceed ${GOAL_OBJECTIVE_MAX_LENGTH} characters.`;

function normalizeTaskId(taskId: string): string | null {
  if (typeof taskId !== "string") return null;
  const normalized = taskId.trim();
  return normalized.length > 0 ? normalized : null;
}

function validateObjective(objective: string): ObjectiveValidation {
  if (typeof objective !== "string" || objective.trim().length === 0) {
    return {
      ok: false,
      error: "empty_objective",
      message: OBJECTIVE_REQUIRED_MESSAGE,
    };
  }

  const normalized = objective.trim();
  if (normalized.length > GOAL_OBJECTIVE_MAX_LENGTH) {
    return {
      ok: false,
      error: "objective_too_long",
      message: OBJECTIVE_TOO_LONG_MESSAGE,
    };
  }

  return { ok: true, objective: normalized };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function normalizeTimestamp(value: number): number {
  if (!isTimestamp(value)) return Date.now();
  return value;
}

/**
 * Builds an isolated key without allowing task identifiers to introduce key
 * separators or collide with one another.
 */
export function getGoalStorageKey(
  taskId: string,
  keyPrefix = GOAL_STORAGE_KEY_PREFIX,
): string | null {
  const normalizedTaskId = normalizeTaskId(taskId);
  if (!normalizedTaskId) return null;
  return `${keyPrefix}:v${GOAL_STORAGE_VERSION}:${encodeURIComponent(normalizedTaskId)}`;
}

/**
 * Parses and validates persisted data. Unknown versions, malformed JSON, and
 * records copied from another task are ignored rather than trusted.
 *
 * A version-less record from the original goal prototype is accepted and
 * normalized to v1. This is the only legacy shape intentionally migrated.
 */
export function deserializeTaskGoal(
  raw: string,
  expectedTaskId: string,
): TaskGoal | null {
  const normalizedTaskId = normalizeTaskId(expectedTaskId);
  if (!normalizedTaskId || typeof raw !== "string") return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;

  const version = value.version;
  if (version !== undefined && version !== GOAL_STORAGE_VERSION) return null;

  // Canonical v1 records must bind themselves to the task. Legacy records did
  // not require taskId, but if one is present it still has to match.
  if (
    (version === GOAL_STORAGE_VERSION && value.taskId !== normalizedTaskId) ||
    (version === undefined &&
      value.taskId !== undefined &&
      value.taskId !== normalizedTaskId)
  ) {
    return null;
  }

  const objectiveValidation = validateObjective(value.objective as string);
  if (!objectiveValidation.ok) return null;
  if (value.status !== "active" && value.status !== "paused") return null;

  const legacyTimestamp = value.timestamp;
  const createdAt = isTimestamp(value.createdAt)
    ? value.createdAt
    : isTimestamp(legacyTimestamp)
      ? legacyTimestamp
      : null;
  const updatedAt = isTimestamp(value.updatedAt)
    ? value.updatedAt
    : isTimestamp(legacyTimestamp)
      ? legacyTimestamp
      : createdAt;

  if (createdAt === null || updatedAt === null || updatedAt < createdAt) {
    return null;
  }

  return {
    version: GOAL_STORAGE_VERSION,
    taskId: normalizedTaskId,
    objective: objectiveValidation.objective,
    status: value.status,
    createdAt,
    updatedAt,
  };
}

/**
 * Creates a lazy localStorage adapter. `window` is resolved only when an
 * adapter method runs, so importing this module is safe during SSR.
 */
export function createBrowserLocalStorageAdapter(
  provider?: BrowserStorageProvider,
): GoalStorageAdapter {
  const resolveStorage = (): BrowserStorageLike | null => {
    if (provider) return provider();
    if (typeof window === "undefined") return null;

    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  return {
    getItem(key) {
      const storage = resolveStorage();
      if (!storage) return null;
      return storage.getItem(key);
    },
    setItem(key, value) {
      const storage = resolveStorage();
      if (!storage) throw new Error("Browser storage is unavailable.");
      storage.setItem(key, value);
    },
    removeItem(key) {
      const storage = resolveStorage();
      if (!storage) throw new Error("Browser storage is unavailable.");
      storage.removeItem(key);
    },
  };
}

export class TaskGoalStore {
  private readonly now: () => number;
  private readonly keyPrefix: string;

  constructor(
    private readonly storage: GoalStorageAdapter,
    options: GoalStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.keyPrefix = options.keyPrefix ?? GOAL_STORAGE_KEY_PREFIX;
  }

  view(taskId: string): GoalStoreResult {
    const keyResult = this.resolveKey(taskId);
    if (!keyResult.ok) return keyResult.result;

    let raw: string | null;
    try {
      raw = this.storage.getItem(keyResult.key);
    } catch {
      return this.storageError();
    }

    if (raw === null) return { ok: true, goal: null, changed: false };

    const goal = deserializeTaskGoal(raw, keyResult.taskId);
    // Incompatible future versions are intentionally left untouched. This
    // makes older clients migration-safe instead of destroying newer data.
    if (!goal) return { ok: true, goal: null, changed: false };

    return { ok: true, goal, changed: false };
  }

  set(taskId: string, objective: string): GoalStoreResult {
    const keyResult = this.resolveKey(taskId);
    if (!keyResult.ok) return keyResult.result;

    const objectiveResult = validateObjective(objective);
    if (!objectiveResult.ok) return objectiveResult;

    const timestamp = normalizeTimestamp(this.now());
    const goal: TaskGoal = {
      version: GOAL_STORAGE_VERSION,
      taskId: keyResult.taskId,
      objective: objectiveResult.objective,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return this.persist(keyResult.key, goal);
  }

  edit(taskId: string, objective: string): GoalStoreResult {
    const objectiveResult = validateObjective(objective);
    if (!objectiveResult.ok) return objectiveResult;

    return this.updateExisting(taskId, (current) => ({
      ...current,
      objective: objectiveResult.objective,
      updatedAt: normalizeTimestamp(this.now()),
    }));
  }

  pause(taskId: string): GoalStoreResult {
    return this.changeStatus(taskId, "paused");
  }

  resume(taskId: string): GoalStoreResult {
    return this.changeStatus(taskId, "active");
  }

  clear(taskId: string): GoalStoreResult {
    const keyResult = this.resolveKey(taskId);
    if (!keyResult.ok) return keyResult.result;

    const current = this.view(taskId);
    if (!current.ok) return current;

    try {
      this.storage.removeItem(keyResult.key);
    } catch {
      return this.storageError();
    }

    return {
      ok: true,
      goal: null,
      changed: current.goal !== null,
    };
  }

  private changeStatus(taskId: string, status: GoalStatus): GoalStoreResult {
    return this.updateExisting(taskId, (current) => {
      if (current.status === status) return current;
      return {
        ...current,
        status,
        updatedAt: normalizeTimestamp(this.now()),
      };
    });
  }

  private updateExisting(
    taskId: string,
    update: (current: TaskGoal) => TaskGoal,
  ): GoalStoreResult {
    const keyResult = this.resolveKey(taskId);
    if (!keyResult.ok) return keyResult.result;

    const currentResult = this.view(taskId);
    if (!currentResult.ok) return currentResult;
    if (!currentResult.goal) {
      return {
        ok: false,
        error: "not_found",
        message: "No goal exists for this task.",
      };
    }

    const next = update(currentResult.goal);
    if (next === currentResult.goal) {
      return { ok: true, goal: currentResult.goal, changed: false };
    }

    return this.persist(keyResult.key, next);
  }

  private persist(key: string, goal: TaskGoal): GoalStoreResult {
    try {
      this.storage.setItem(key, JSON.stringify(goal));
    } catch {
      return this.storageError();
    }
    return { ok: true, goal, changed: true };
  }

  private resolveKey(
    taskId: string,
  ):
    | Readonly<{ ok: true; key: string; taskId: string }>
    | Readonly<{ ok: false; result: GoalStoreResult }> {
    const normalizedTaskId = normalizeTaskId(taskId);
    const key = getGoalStorageKey(taskId, this.keyPrefix);
    if (!normalizedTaskId || !key) {
      return {
        ok: false,
        result: {
          ok: false,
          error: "invalid_task_id",
          message: "A non-empty task id is required.",
        },
      };
    }
    return { ok: true, key, taskId: normalizedTaskId };
  }

  private storageError(): GoalStoreResult {
    return {
      ok: false,
      error: "storage_unavailable",
      message: "Goal storage is unavailable.",
    };
  }
}

export function parseGoalCommand(input: string): GoalCommandParseResult {
  if (typeof input !== "string") return { kind: "not_goal_command" };

  const match = input.trim().match(/^\/goal(?:\s+([\s\S]*))?$/i);
  if (!match) return { kind: "not_goal_command" };

  const body = (match[1] ?? "").trim();
  if (!body) return { kind: "command", command: { action: "view" } };

  const tokenMatch = body.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!tokenMatch) return { kind: "command", command: { action: "view" } };

  const keyword = tokenMatch[1].toLowerCase();
  const remainder = (tokenMatch[2] ?? "").trim();

  if (keyword === "edit") {
    if (!remainder) {
      return {
        kind: "needs_input",
        action: "edit",
        message: "Enter the updated goal objective.",
      };
    }
    if (remainder.length > GOAL_OBJECTIVE_MAX_LENGTH) {
      return {
        kind: "invalid",
        reason: "objective_too_long",
        message: OBJECTIVE_TOO_LONG_MESSAGE,
      };
    }
    return {
      kind: "command",
      command: { action: "edit", objective: remainder },
    };
  }

  if (
    keyword === "view" ||
    keyword === "pause" ||
    keyword === "resume" ||
    keyword === "clear"
  ) {
    if (remainder) {
      return {
        kind: "invalid",
        reason: "unexpected_arguments",
        message: `/goal ${keyword} does not accept additional text.`,
      };
    }
    return {
      kind: "command",
      command: { action: keyword },
    };
  }

  if (body.length > GOAL_OBJECTIVE_MAX_LENGTH) {
    return {
      kind: "invalid",
      reason: "objective_too_long",
      message: OBJECTIVE_TOO_LONG_MESSAGE,
    };
  }

  return {
    kind: "command",
    command: { action: "set", objective: body },
  };
}

export function executeGoalCommand(
  store: TaskGoalStore,
  taskId: string,
  command: GoalCommand,
): GoalStoreResult {
  switch (command.action) {
    case "view":
      return store.view(taskId);
    case "set":
      return store.set(taskId, command.objective);
    case "edit":
      return store.edit(taskId, command.objective);
    case "pause":
      return store.pause(taskId);
    case "resume":
      return store.resume(taskId);
    case "clear":
      return store.clear(taskId);
  }
}
