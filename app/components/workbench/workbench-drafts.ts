import type { WorkbenchDocument } from "./types";

const DRAFT_VERSION = 1;
const DRAFT_PREFIX = "rift:workbench:drafts:v1:";
const MAX_PERSISTED_DOCUMENTS = 20;
const MAX_DOCUMENT_CHARACTERS = 1_000_000;
const MAX_TOTAL_CHARACTERS = 3_000_000;

export type WorkbenchDraftSnapshot = {
  openTabs: string[];
  activePath: string | null;
  documents: Record<string, WorkbenchDocument>;
};

type PersistedDraft = {
  version: 1;
  savedAt: number;
  openTabs: string[];
  activePath: string | null;
  documents: Record<
    string,
    Pick<
      WorkbenchDocument,
      "path" | "content" | "savedContent" | "revision" | "size" | "modifiedAt"
    >
  >;
};

function storageKey(scope: string): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(scope).slice(0, 180)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDocument(
  path: string,
  value: unknown,
): WorkbenchDocument | null {
  if (!isRecord(value) || value.path !== path) return null;
  if (
    typeof value.content !== "string" ||
    typeof value.savedContent !== "string" ||
    typeof value.revision !== "string" ||
    typeof value.size !== "number" ||
    (value.modifiedAt !== null && typeof value.modifiedAt !== "string")
  ) {
    return null;
  }
  if (
    value.content.length > MAX_DOCUMENT_CHARACTERS ||
    value.savedContent.length > MAX_DOCUMENT_CHARACTERS
  ) {
    return null;
  }

  return {
    path,
    content: value.content,
    savedContent: value.savedContent,
    revision: value.revision,
    size: value.size,
    modifiedAt: value.modifiedAt as string | null,
    status: "ready",
    error: null,
    conflict: null,
  };
}

export function readWorkbenchDraft(
  scope: string,
  storage: Storage | null = typeof window === "undefined"
    ? null
    : window.sessionStorage,
): WorkbenchDraftSnapshot | null {
  if (!storage) return null;
  const key = storageKey(scope);
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== DRAFT_VERSION) {
      storage.removeItem(key);
      return null;
    }
    const candidateTabs = Array.isArray(parsed.openTabs)
      ? parsed.openTabs
          .filter((path): path is string => typeof path === "string")
          .slice(0, MAX_PERSISTED_DOCUMENTS)
      : [];
    const candidateDocuments = isRecord(parsed.documents)
      ? parsed.documents
      : {};
    const documents: Record<string, WorkbenchDocument> = {};
    let totalCharacters = 0;

    for (const path of candidateTabs) {
      const document = normalizeDocument(path, candidateDocuments[path]);
      if (!document) continue;
      totalCharacters += document.content.length + document.savedContent.length;
      if (totalCharacters > MAX_TOTAL_CHARACTERS) break;
      documents[path] = document;
    }

    const openTabs = candidateTabs.filter((path) => documents[path]);
    const activePath =
      typeof parsed.activePath === "string" &&
      openTabs.includes(parsed.activePath)
        ? parsed.activePath
        : (openTabs[0] ?? null);
    if (openTabs.length === 0) {
      storage.removeItem(key);
      return null;
    }
    return { openTabs, activePath, documents };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be disabled by the browser. Draft protection then falls
      // back to the beforeunload and navigation guards in the provider.
    }
    return null;
  }
}

export function writeWorkbenchDraft(
  scope: string,
  snapshot: WorkbenchDraftSnapshot,
  storage: Storage | null = typeof window === "undefined"
    ? null
    : window.sessionStorage,
): boolean {
  if (!storage) return false;
  const key = storageKey(scope);
  const uniqueTabs = [...new Set(snapshot.openTabs)].slice(
    0,
    MAX_PERSISTED_DOCUMENTS,
  );
  const priorityTabs = [...uniqueTabs].sort((left, right) => {
    const leftDocument = snapshot.documents[left];
    const rightDocument = snapshot.documents[right];
    const leftDirty =
      leftDocument?.content !== leftDocument?.savedContent ? 1 : 0;
    const rightDirty =
      rightDocument?.content !== rightDocument?.savedContent ? 1 : 0;
    if (left === snapshot.activePath) return -1;
    if (right === snapshot.activePath) return 1;
    return rightDirty - leftDirty;
  });
  const documents: PersistedDraft["documents"] = {};
  let totalCharacters = 0;

  for (const path of priorityTabs) {
    const document = snapshot.documents[path];
    if (
      !document ||
      !["ready", "saving", "conflict"].includes(document.status)
    ) {
      continue;
    }
    const documentCharacters =
      document.content.length + document.savedContent.length;
    if (
      document.content.length > MAX_DOCUMENT_CHARACTERS ||
      document.savedContent.length > MAX_DOCUMENT_CHARACTERS ||
      totalCharacters + documentCharacters > MAX_TOTAL_CHARACTERS
    ) {
      continue;
    }
    totalCharacters += documentCharacters;
    documents[path] = {
      path,
      content: document.content,
      savedContent: document.savedContent,
      revision: document.revision,
      size: document.size,
      modifiedAt: document.modifiedAt,
    };
  }

  const persistedTabs = uniqueTabs.filter((path) => documents[path]);
  if (persistedTabs.length === 0) {
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  const payload: PersistedDraft = {
    version: DRAFT_VERSION,
    savedAt: Date.now(),
    openTabs: persistedTabs,
    activePath:
      snapshot.activePath && persistedTabs.includes(snapshot.activePath)
        ? snapshot.activePath
        : persistedTabs[0],
    documents,
  };

  try {
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
