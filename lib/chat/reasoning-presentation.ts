export type ReasoningPresentationStepStatus = "active" | "complete";

export interface ReasoningPresentationStep {
  id: string;
  title: string;
  detail?: string;
  status: ReasoningPresentationStepStatus;
}

export interface ReasoningPresentation {
  /** Compact Cursor-style label safe to render beside the disclosure arrow. */
  title: string;
  /** Named public progress summaries derived from the already-visible text. */
  steps: readonly ReasoningPresentationStep[];
  source: "named-step" | "summary" | "fallback";
}

const MAX_TITLE_LENGTH = 72;
const MAX_DETAIL_LENGTH = 280;

const compact = (value: string): string => value.replace(/\s+/g, " ").trim();

function stripInlineMarkdown(value: string): string {
  return compact(
    value
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .replace(/^\s*(?:[-+]|\d+[.)])\s+/, "")
      .replace(/\s*[:：]\s*$/, ""),
  );
}

function clamp(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const candidate = value.slice(0, maximum + 1);
  const breakAt = candidate.lastIndexOf(" ");
  const end = breakAt >= Math.floor(maximum * 0.62) ? breakAt : maximum;
  return `${candidate.slice(0, end).trimEnd()}…`;
}

function normalizeTitle(value: string): string {
  return clamp(
    stripInlineMarkdown(value)
      .replace(/^(?:step|phase|stage|pass)\s+\d+\s*[:.)-]?\s*/i, "")
      .replace(/^(?:i|we)\s+(?:need|want|plan|have)\s+to\s+/i, "")
      .replace(/^let(?:'|’)s\s+/i, ""),
    MAX_TITLE_LENGTH,
  );
}

type NamedSection = { title: string; detailLines: string[] };

function explicitTitle(line: string): string | null {
  const trimmed = line.trim();
  const heading = trimmed.match(/^#{1,6}\s+(.+)$/)?.[1];
  const emphasized = trimmed.match(/^\*\*(.+?)\*\*\s*:?[\s]*$/)?.[1];
  const numbered = trimmed.match(/^\d+[.)]\s+(.{2,96})$/)?.[1];
  const candidate = heading ?? emphasized ?? numbered;
  if (!candidate) return null;
  const title = normalizeTitle(candidate);
  return title.length >= 2 ? title : null;
}

function namedSections(text: string): NamedSection[] {
  const sections: NamedSection[] = [];
  let current: NamedSection | null = null;
  let inFence = false;

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const title = explicitTitle(line);
    if (title) {
      current = { title, detailLines: [] };
      sections.push(current);
      continue;
    }
    if (current && line.trim()) current.detailLines.push(line.trim());
  }

  return sections;
}

function summaryTitle(text: string): string | null {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*(?:[-+]|\d+[.)])\s+/gm, "")
    .split(/\n\s*\n|(?<=[.!?])\s+/)
    .map(normalizeTitle)
    .find((candidate) => candidate.length >= 4);
  return plain || null;
}

/**
 * Convert provider reasoning that is already present in the transcript into a
 * stable, compact presentation contract. This never invents or requests hidden
 * chain-of-thought; it only labels text the UI already received.
 */
export function buildReasoningPresentation(
  text: string,
  isStreaming: boolean,
): ReasoningPresentation {
  const sections = namedSections(text);
  if (sections.length > 0) {
    const steps = sections.map((section, index) => {
      const detail = clamp(
        stripInlineMarkdown(section.detailLines.join(" ")),
        MAX_DETAIL_LENGTH,
      );
      return {
        id: `reasoning-step-${index}`,
        title: section.title,
        ...(detail ? { detail } : {}),
        status:
          isStreaming && index === sections.length - 1
            ? ("active" as const)
            : ("complete" as const),
      };
    });
    return {
      title: steps.at(-1)?.title ?? "Planning next moves",
      steps,
      source: "named-step",
    };
  }

  const summary = summaryTitle(text);
  if (summary) {
    return {
      title: summary,
      steps: [
        {
          id: "reasoning-step-0",
          title: summary,
          status: isStreaming ? "active" : "complete",
        },
      ],
      source: "summary",
    };
  }

  return {
    title: isStreaming ? "Planning next moves" : "Reviewed approach",
    steps: [],
    source: "fallback",
  };
}
