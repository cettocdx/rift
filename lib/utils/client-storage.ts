import {
  BUILD_MODELS,
  coerceSelectedModel,
  isBuildReasoningEffortSupported,
  isChatMode,
  type BuildModelId,
  type ChatMode,
  type ReasoningEffort,
  type SelectedModel,
} from "@/types/chat";

export type ConversationDraft = {
  id: string;
  content: string;
  timestamp: number;
};

export type ConversationDraftStore = {
  drafts: Array<ConversationDraft>;
  userId?: string;
};

export const CONVERSATION_DRAFTS_STORAGE_KEY = "conversation_drafts";
export const NULL_THREAD_DRAFT_ID = "null_thread";
export const CHAT_MODE_STORAGE_KEY = "chat_mode";
const HAS_AUTHENTICATED_BEFORE_STORAGE_KEY = "rift_has_authed_before";
const SELECTED_MODEL_STORAGE_KEY = "selected_model";
export const BUILD_REASONING_EFFORTS_STORAGE_KEY = "build_reasoning_efforts";

export type BuildReasoningEffortPreferences = Partial<
  Record<BuildModelId, ReasoningEffort>
>;

const isBrowser = (): boolean => typeof window !== "undefined";

export const readDraftStore = (): ConversationDraftStore => {
  if (!isBrowser()) return { drafts: [] };
  try {
    const raw = window.localStorage.getItem(CONVERSATION_DRAFTS_STORAGE_KEY);
    if (!raw) return { drafts: [] };
    const parsed = JSON.parse(raw);
    const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
    const userId =
      typeof parsed?.userId === "string" ? parsed.userId : undefined;
    return { drafts, userId };
  } catch {
    return { drafts: [] };
  }
};

export const writeDraftStore = (store: ConversationDraftStore): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      CONVERSATION_DRAFTS_STORAGE_KEY,
      JSON.stringify({ drafts: store.drafts, userId: store.userId }),
    );
    window.dispatchEvent(new Event("rift:drafts-changed"));
  } catch {
    // ignore
  }
};

export const readChatMode = (): ChatMode | null => {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(CHAT_MODE_STORAGE_KEY);
    return isChatMode(raw) ? raw : null;
  } catch {
    return null;
  }
};

export const writeChatMode = (mode: ChatMode): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(CHAT_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
};

export const markHasAuthenticatedBefore = (): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(HAS_AUTHENTICATED_BEFORE_STORAGE_KEY, "true");
  } catch {
    // ignore
  }
};

export const hasAuthenticatedBefore = (): boolean => {
  if (!isBrowser()) return false;
  try {
    return (
      window.localStorage.getItem(HAS_AUTHENTICATED_BEFORE_STORAGE_KEY) ===
      "true"
    );
  } catch {
    return false;
  }
};

/**
 * Read the saved model preference (shared across ask + agent modes).
 * Migrates two flavors of legacy values when present:
 *   1. Per-mode keys from before the unified preference: `selected_model_ask`
 *      and `selected_model_agent`.
 *   2. Underlying-model ids from before the RIFT tier rebrand
 *      (e.g. `"opus-4.6"` → `"rift-max"`) — handled by `coerceSelectedModel`.
 * Both kinds are rewritten to the unified key in their new form so the
 * migration is a one-shot.
 */
export const readSelectedModel = (): SelectedModel | null => {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
    const coerced = coerceSelectedModel(raw);
    if (coerced) {
      // If the stored value was a legacy underlying-model id, rewrite it.
      if (raw !== coerced) {
        window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, coerced);
      }
      return coerced;
    }
    // Migrate from legacy per-mode keys (selected_model_ask / selected_model_agent).
    const legacyAsk = window.localStorage.getItem(
      `${SELECTED_MODEL_STORAGE_KEY}_ask`,
    );
    const legacyAgent = window.localStorage.getItem(
      `${SELECTED_MODEL_STORAGE_KEY}_agent`,
    );
    const legacy =
      coerceSelectedModel(legacyAsk) ?? coerceSelectedModel(legacyAgent);
    if (legacy) {
      window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, legacy);
      window.localStorage.removeItem(`${SELECTED_MODEL_STORAGE_KEY}_ask`);
      window.localStorage.removeItem(`${SELECTED_MODEL_STORAGE_KEY}_agent`);
    }
    return legacy;
  } catch {
    return null;
  }
};

/** Save the model preference (shared across ask + agent modes). */
export const writeSelectedModel = (model: SelectedModel): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, model);
  } catch {
    // ignore
  }
};

/**
 * Read only model/effort pairs that are still present in the Build catalog.
 * Invalid and stale values are dropped instead of silently migrating one
 * model's preference onto another model with different capabilities.
 */
export const readBuildReasoningEfforts =
  (): BuildReasoningEffortPreferences => {
    if (!isBrowser()) return {};
    try {
      const raw = window.localStorage.getItem(
        BUILD_REASONING_EFFORTS_STORAGE_KEY,
      );
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      const record = parsed as Record<string, unknown>;
      const preferences: BuildReasoningEffortPreferences = {};
      for (const model of BUILD_MODELS) {
        const effort = record[model.id];
        if (isBuildReasoningEffortSupported(model.id, effort)) {
          preferences[model.id] = effort;
        }
      }
      return preferences;
    } catch {
      return {};
    }
  };

/** Persist a sanitized per-Build-model effort map. */
export const writeBuildReasoningEfforts = (
  preferences: BuildReasoningEffortPreferences,
): void => {
  if (!isBrowser()) return;
  try {
    const safePreferences: BuildReasoningEffortPreferences = {};
    for (const model of BUILD_MODELS) {
      const effort = preferences[model.id];
      if (isBuildReasoningEffortSupported(model.id, effort)) {
        safePreferences[model.id] = effort;
      }
    }
    window.localStorage.setItem(
      BUILD_REASONING_EFFORTS_STORAGE_KEY,
      JSON.stringify(safePreferences),
    );
  } catch {
    // ignore
  }
};

/** Remove the persisted model preference (and any legacy per-mode keys) — e.g. on logout. */
export const clearSelectedModelFromStorage = (): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(SELECTED_MODEL_STORAGE_KEY);
    window.localStorage.removeItem(`${SELECTED_MODEL_STORAGE_KEY}_ask`);
    window.localStorage.removeItem(`${SELECTED_MODEL_STORAGE_KEY}_agent`);
    window.localStorage.removeItem(BUILD_REASONING_EFFORTS_STORAGE_KEY);
  } catch {
    // ignore
  }
};

export const getDraftContentById = (id: string): string | null => {
  const store = readDraftStore();
  const entry = store.drafts.find((d) => d.id === id);
  return entry ? entry.content : null;
};

export const upsertDraft = (
  id: string,
  content: string,
  timestamp?: number,
): void => {
  const store = readDraftStore();
  const idx = store.drafts.findIndex((d) => d.id === id);
  const entry: ConversationDraft = {
    id,
    content,
    timestamp: typeof timestamp === "number" ? timestamp : Date.now(),
  };
  if (idx >= 0) {
    store.drafts[idx] = entry;
  } else {
    store.drafts.push(entry);
  }
  writeDraftStore(store);
};

export const removeDraft = (id: string): void => {
  const store = readDraftStore();
  const nextDrafts = store.drafts.filter((d) => d.id !== id);
  writeDraftStore({ ...store, drafts: nextDrafts });
};

export const getDrafts = (): Array<ConversationDraft> =>
  readDraftStore().drafts;

export const getUserIdFromDrafts = (): string | undefined =>
  readDraftStore().userId;

export const setUserIdInDrafts = (userId: string): void => {
  const store = readDraftStore();
  writeDraftStore({ ...store, userId });
};

// Invalidate pending composer saves when sign-out clears local drafts.
let draftEpoch = 0;
export const getDraftEpoch = (): number => draftEpoch;

export const clearAllDrafts = (): void => {
  draftEpoch += 1;
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(CONVERSATION_DRAFTS_STORAGE_KEY);
  } catch {
    // ignore
  }
};

/**
 * Removes drafts older than 7 days
 * Called on app initialization to prevent localStorage bloat
 */
export const cleanupExpiredDrafts = (): void => {
  if (!isBrowser()) return;

  try {
    const store = readDraftStore();
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    // Filter out drafts older than 7 days
    const validDrafts = store.drafts.filter((draft) => {
      const age = now - draft.timestamp;
      return age < SEVEN_DAYS_MS;
    });

    // Only write if we actually removed drafts (avoid unnecessary writes)
    if (validDrafts.length !== store.drafts.length) {
      writeDraftStore({ ...store, drafts: validDrafts });
      console.log(
        `[Draft Cleanup] Removed ${store.drafts.length - validDrafts.length} expired drafts`,
      );
    }
  } catch (error) {
    // Silently fail - cleanup is not critical
    console.warn("[Draft Cleanup] Failed to cleanup expired drafts:", error);
  }
};
