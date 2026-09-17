import type { FileUploadStore } from "@/app/hooks/useFileUpload";
import type { UploadedFileState } from "@/types/file";

type DraftSnapshot = { target: string; cmd: string; activeOp: string };
type StringUpdate = string | ((previous: string) => string);
const EMPTY_DRAFT: DraftSnapshot = { target: "", cmd: "", activeOp: "" };

function createUploadStore(): FileUploadStore {
  const files = new Map<string, UploadedFileState>();
  // Old rendered rows keep their identity after updates or another row's removal.
  const identities = new WeakMap<UploadedFileState, string>();
  const listeners = new Set<() => void>();
  let snapshot: UploadedFileState[] = [];
  const publish = () => {
    snapshot = [...files.values()];
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    add: (file) => {
      const id = crypto.randomUUID();
      const next = { ...file };
      identities.set(file, id);
      identities.set(next, id);
      files.set(id, next);
      publish();
      return id;
    },
    update: (id, partial) => {
      const previous = files.get(id);
      if (!previous) return;
      const next = { ...previous, ...partial };
      identities.set(next, id);
      files.set(id, next);
      publish();
    },
    remove: (id) => {
      if (files.delete(id)) publish();
    },
    idOf: (file) => identities.get(file),
    clear: () => {
      if (!files.size) return;
      files.clear();
      publish();
    },
    getTotalTokens: () =>
      snapshot.reduce((total, file) => total + (file.tokens ?? 0), 0),
  };
}

export function createHackAssessmentDraft() {
  let snapshot = EMPTY_DRAFT;
  const listeners = new Set<() => void>();
  const setter = (key: keyof DraftSnapshot) => (update: StringUpdate) => {
    const value = typeof update === "function" ? update(snapshot[key]) : update;
    if (value === snapshot[key]) return;
    snapshot = { ...snapshot, [key]: value };
    listeners.forEach((listener) => listener());
  };
  return {
    uploads: createUploadStore(),
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY_DRAFT,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setTarget: setter("target"),
    setCmd: setter("cmd"),
    setActiveOp: setter("activeOp"),
  };
}

const drafts = new Map<string, ReturnType<typeof createHackAssessmentDraft>>();

/** Window-local drafts only. Requests and raw attachments never enter browser storage. */
export function getHackAssessmentDraft(accountId: string, sessionId: string) {
  // Server rendering must not retain one user's drafts in a shared process.
  if (typeof window === "undefined") return createHackAssessmentDraft();
  const key = JSON.stringify([accountId, sessionId]);
  let draft = drafts.get(key);
  if (!draft) {
    draft = createHackAssessmentDraft();
    drafts.set(key, draft);
  }
  return draft;
}
