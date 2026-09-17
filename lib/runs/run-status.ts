/**
 * The canonical Run status vocabulary.
 *
 * Before this, a run's state was inferred from `ChatStatus`
 * (`submitted | streaming | ready | error`), which cannot express the
 * difference between "the user stopped this", "the provider dropped", and "it
 * finished". Every surface therefore invented its own words for the same
 * states, and a stopped run was indistinguishable from a completed one.
 *
 * These are the words the product uses. A status that cannot be derived from
 * server-authoritative data must not be shown -- an invented status is the same
 * class of lie as a fabricated exit code.
 */

export const RUN_STATUSES = [
  "draft",
  "queued",
  "starting",
  "running",
  "waiting_for_approval",
  "stopping",
  "cancelled",
  "failed",
  "completed",
  "completed_with_warnings",
  "degraded",
  "disconnected",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Semantic tone. Kept separate from any palette so a status means the same
 * thing in every theme and on every surface.
 */
export type RunStatusTone =
  | "neutral" // nothing is happening, and nothing is wrong
  | "active" // work is in flight
  | "attention" // a person needs to decide something
  | "success"
  | "warning"
  | "danger";

export interface RunStatusMeta {
  /** Sentence-case label shown to a person. */
  label: string;
  tone: RunStatusTone;
  /** True while the run is still expected to change on its own. */
  isTerminal: boolean;
  /** True when the outcome is a person's decision rather than a failure. */
  isUserInitiated: boolean;
}

export const RUN_STATUS_META: Record<RunStatus, RunStatusMeta> = {
  draft: {
    label: "Draft",
    tone: "neutral",
    isTerminal: false,
    isUserInitiated: true,
  },
  queued: {
    label: "Queued",
    tone: "neutral",
    isTerminal: false,
    isUserInitiated: false,
  },
  starting: {
    label: "Starting",
    tone: "active",
    isTerminal: false,
    isUserInitiated: false,
  },
  running: {
    label: "Running",
    tone: "active",
    isTerminal: false,
    isUserInitiated: false,
  },
  waiting_for_approval: {
    label: "Waiting for approval",
    tone: "attention",
    isTerminal: false,
    isUserInitiated: false,
  },
  stopping: {
    label: "Stopping",
    tone: "active",
    isTerminal: false,
    isUserInitiated: true,
  },
  cancelled: {
    // Never "failed": the user asked for this, and blaming the product for
    // doing what it was told is what the old wording did.
    label: "Cancelled",
    tone: "neutral",
    isTerminal: true,
    isUserInitiated: true,
  },
  failed: {
    label: "Failed",
    tone: "danger",
    isTerminal: true,
    isUserInitiated: false,
  },
  completed: {
    label: "Completed",
    tone: "success",
    isTerminal: true,
    isUserInitiated: false,
  },
  completed_with_warnings: {
    label: "Completed with warnings",
    tone: "warning",
    isTerminal: true,
    isUserInitiated: false,
  },
  degraded: {
    label: "Degraded",
    tone: "warning",
    isTerminal: false,
    isUserInitiated: false,
  },
  disconnected: {
    // The stream is gone but the run may well still be executing. This is
    // explicitly NOT a terminal state: the client must not infer completion
    // from the absence of events.
    label: "Disconnected",
    tone: "warning",
    isTerminal: false,
    isUserInitiated: false,
  },
};

export function isRunStatus(value: unknown): value is RunStatus {
  return (
    typeof value === "string" && (RUN_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Narrows an unknown status from storage. Unrecognised values become
 * `disconnected` rather than a guess at success or failure: not knowing is a
 * real state, and it is the only honest one here.
 */
export function toRunStatus(value: unknown): RunStatus {
  return isRunStatus(value) ? value : "disconnected";
}

export function runStatusMeta(status: RunStatus): RunStatusMeta {
  return RUN_STATUS_META[status];
}

/** The filters the Runs destination offers, in the order it offers them. */
export const RUN_STATUS_FILTERS = [
  { id: "running", label: "Running", matches: ["starting", "running", "stopping", "queued"] },
  {
    id: "needs_attention",
    label: "Needs attention",
    matches: ["waiting_for_approval", "degraded", "disconnected"],
  },
  { id: "completed", label: "Completed", matches: ["completed", "completed_with_warnings"] },
  { id: "failed", label: "Failed", matches: ["failed"] },
  { id: "cancelled", label: "Cancelled", matches: ["cancelled"] },
  { id: "scheduled", label: "Scheduled", matches: ["draft"] },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  matches: readonly RunStatus[];
}>;

export type RunStatusFilterId = (typeof RUN_STATUS_FILTERS)[number]["id"];

export function matchesRunFilter(
  status: RunStatus,
  filterId: RunStatusFilterId | "all",
): boolean {
  if (filterId === "all") return true;
  const filter = RUN_STATUS_FILTERS.find((entry) => entry.id === filterId);
  if (!filter) return false;
  return (filter.matches as readonly RunStatus[]).includes(status);
}
