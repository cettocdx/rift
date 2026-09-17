import {
  MAX_WORKBENCH_TERMINALS_PER_WORKSPACE,
  isWorkbenchClientTerminalId,
  isWorkbenchTerminalProfile,
  type WorkbenchTerminalProfile,
} from "@/lib/workbench/interactive-terminal-contract";

export type WorkbenchTerminalTab = {
  clientTerminalId: string;
  label: string;
  profile: WorkbenchTerminalProfile;
};

export type WorkbenchTerminalSplit = {
  direction: "right" | "down";
  secondaryId: string;
};

export type WorkbenchTerminalLayout = {
  version: 1;
  tabs: WorkbenchTerminalTab[];
  activeId: string;
  split: WorkbenchTerminalSplit | null;
  nextOrdinal: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createClientTerminalId() {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `terminal-${random}`.slice(0, 64);
}

export function createInitialTerminalLayout(
  clientTerminalId = createClientTerminalId(),
  profile: WorkbenchTerminalProfile = "shell",
): WorkbenchTerminalLayout {
  return {
    version: 1,
    tabs: [{ clientTerminalId, label: "Terminal 1", profile }],
    activeId: clientTerminalId,
    split: null,
    nextOrdinal: 2,
  };
}

export function parseTerminalLayout(value: string | null) {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (record?.version !== 1 || !Array.isArray(record.tabs)) return null;
  const tabs: WorkbenchTerminalTab[] = [];
  const ids = new Set<string>();
  for (const candidate of record.tabs.slice(
    0,
    MAX_WORKBENCH_TERMINALS_PER_WORKSPACE,
  )) {
    const tab = asRecord(candidate);
    if (
      !isWorkbenchClientTerminalId(tab?.clientTerminalId) ||
      ids.has(tab.clientTerminalId) ||
      typeof tab.label !== "string" ||
      tab.label.length < 1 ||
      tab.label.length > 40
    ) {
      continue;
    }
    ids.add(tab.clientTerminalId);
    tabs.push({
      clientTerminalId: tab.clientTerminalId,
      label: tab.label,
      profile: isWorkbenchTerminalProfile(tab.profile) ? tab.profile : "shell",
    });
  }
  if (tabs.length === 0) {
    // Empty is deliberate only when the persisted layout explicitly says so.
    // Invalid saved tabs must not silently become a valid closed layout.
    if (
      record.tabs.length !== 0 ||
      record.activeId !== "" ||
      record.split !== null
    )
      return null;
    return {
      version: 1,
      tabs: [],
      activeId: "",
      split: null,
      nextOrdinal:
        typeof record.nextOrdinal === "number" &&
        Number.isSafeInteger(record.nextOrdinal) &&
        record.nextOrdinal > 0
          ? record.nextOrdinal
          : 1,
    } satisfies WorkbenchTerminalLayout;
  }

  const activeId = isWorkbenchClientTerminalId(record.activeId)
    ? record.activeId
    : tabs[0].clientTerminalId;
  const safeActiveId = ids.has(activeId) ? activeId : tabs[0].clientTerminalId;
  const rawSplit = asRecord(record.split);
  const secondaryId = rawSplit?.secondaryId;
  let split: WorkbenchTerminalSplit | null = null;
  if (
    (rawSplit?.direction === "right" || rawSplit?.direction === "down") &&
    isWorkbenchClientTerminalId(secondaryId) &&
    ids.has(secondaryId) &&
    secondaryId !== safeActiveId
  ) {
    split = { direction: rawSplit.direction, secondaryId };
  }
  const nextOrdinal =
    typeof record.nextOrdinal === "number" &&
    Number.isSafeInteger(record.nextOrdinal) &&
    record.nextOrdinal > 0
      ? record.nextOrdinal
      : tabs.length + 1;

  return {
    version: 1,
    tabs,
    activeId: safeActiveId,
    split,
    nextOrdinal,
  } satisfies WorkbenchTerminalLayout;
}

export function addTerminalToLayout(
  layout: WorkbenchTerminalLayout,
  clientTerminalId = createClientTerminalId(),
  profile: WorkbenchTerminalProfile = "shell",
) {
  if (layout.tabs.length >= MAX_WORKBENCH_TERMINALS_PER_WORKSPACE) {
    return layout;
  }
  return {
    ...layout,
    tabs: [
      ...layout.tabs,
      {
        clientTerminalId,
        label: `Terminal ${layout.nextOrdinal}`,
        profile,
      },
    ],
    activeId: clientTerminalId,
    nextOrdinal: layout.nextOrdinal + 1,
  } satisfies WorkbenchTerminalLayout;
}

export function selectTerminalInLayout(
  layout: WorkbenchTerminalLayout,
  clientTerminalId: string,
) {
  if (!layout.tabs.some((tab) => tab.clientTerminalId === clientTerminalId)) {
    return layout;
  }
  if (layout.split?.secondaryId === clientTerminalId) {
    return {
      ...layout,
      activeId: clientTerminalId,
      split: { ...layout.split, secondaryId: layout.activeId },
    } satisfies WorkbenchTerminalLayout;
  }
  return { ...layout, activeId: clientTerminalId };
}

export function splitTerminalLayout(
  layout: WorkbenchTerminalLayout,
  direction: WorkbenchTerminalSplit["direction"],
  newClientTerminalId = createClientTerminalId(),
  profile: WorkbenchTerminalProfile = "shell",
) {
  if (layout.tabs.length === 0)
    return addTerminalToLayout(layout, newClientTerminalId, profile);
  if (layout.split) {
    return { ...layout, split: { ...layout.split, direction } };
  }

  if (layout.tabs.length < MAX_WORKBENCH_TERMINALS_PER_WORKSPACE) {
    const tab: WorkbenchTerminalTab = {
      clientTerminalId: newClientTerminalId,
      label: `Terminal ${layout.nextOrdinal}`,
      profile,
    };
    return {
      ...layout,
      tabs: [...layout.tabs, tab],
      split: { direction, secondaryId: newClientTerminalId },
      nextOrdinal: layout.nextOrdinal + 1,
    } satisfies WorkbenchTerminalLayout;
  }

  const secondary = layout.tabs.find(
    (tab) => tab.clientTerminalId !== layout.activeId,
  );
  if (!secondary) return layout;
  return {
    ...layout,
    split: { direction, secondaryId: secondary.clientTerminalId },
  } satisfies WorkbenchTerminalLayout;
}

export function closeTerminalInLayout(
  layout: WorkbenchTerminalLayout,
  clientTerminalId: string,
) {
  const index = layout.tabs.findIndex(
    (tab) => tab.clientTerminalId === clientTerminalId,
  );
  if (index < 0) return layout;
  const tabs = layout.tabs.filter(
    (tab) => tab.clientTerminalId !== clientTerminalId,
  );
  if (tabs.length === 0) {
    return {
      ...layout,
      tabs: [],
      activeId: "",
      split: null,
    } satisfies WorkbenchTerminalLayout;
  }

  const closedPrimary = layout.activeId === clientTerminalId;
  const closedSecondary = layout.split?.secondaryId === clientTerminalId;
  const activeId = closedPrimary
    ? (layout.split?.secondaryId ??
      tabs[Math.min(index, tabs.length - 1)].clientTerminalId)
    : layout.activeId;
  return {
    ...layout,
    tabs,
    activeId,
    split:
      closedPrimary || closedSecondary || layout.split?.secondaryId === activeId
        ? null
        : layout.split,
  } satisfies WorkbenchTerminalLayout;
}
