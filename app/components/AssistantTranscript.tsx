"use client";

import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { openAgentActivity } from "@/lib/workbench/events";
import type { ChatStatus } from "@/types";
import {
  ActivityIcon,
  AgentActivityMark,
} from "@/components/ai-elements/activity-icon";
import {
  classifyTranscriptTool,
  summarizeTranscriptTools,
} from "@/lib/chat/transcript-presentation";

export type TranscriptPart = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  approval?: unknown;
  state?: string;
  input?: unknown;
  output?: unknown;
  text?: string;
  errorText?: string;
};

type Segment = { kind: "part" | "tools"; indexes: number[] };
const inlineResults = new Set([
  "tool-generate_image",
  "tool-generate_video",
  "tool-expose_preview",
  "tool-get_terminal_files",
  "tool-ask_user",
  "tool-ask_question",
  "tool-request_approval",
  "tool-desktop_access_status",
]);

/** Keep the model's explanation in order, with consecutive work folded locally.
 * Metadata never creates a visual row or splits a group. Media stays inline at
 * its original position, outside collapsed work. Original indexes remain intact. */
export function transcriptSegments(
  parts: readonly TranscriptPart[],
): Segment[] {
  const segments: Segment[] = [];
  parts.forEach((part, index) => {
    if (part.type === "file") return;
    if (part.type.startsWith("data-") && part.type !== "data-summarization")
      return;
    if (part.type === "step-start" || part.type === "finish-step") return;
    const grouped =
      (part.type.startsWith("tool-") || part.type === "dynamic-tool") &&
      !inlineResults.has(part.type) &&
      !(
        ["tool-desktop_screenshot", "tool-desktop_computer_action"].includes(
          part.type,
        ) &&
        part.output &&
        typeof part.output === "object" &&
        (part.output as Record<string, unknown>).ok === false
      ) &&
      !part.state?.startsWith("approval-");
    const previous = segments.at(-1);
    const sameWorkKind =
      previous?.kind === "tools" &&
      (classifyTranscriptTool(parts[previous.indexes[0]]) === "agent") ===
        (classifyTranscriptTool(part) === "agent");
    if (grouped && previous?.kind === "tools" && sameWorkKind)
      previous.indexes.push(index);
    else segments.push({ kind: grouped ? "tools" : "part", indexes: [index] });
  });
  // A reasoning phase followed by a tool has finished, even when a provider
  // omits state="done". Fold its existing disclosure into that work's details;
  // keep trailing/live reasoning and all prose/approval boundaries visible.
  const compact: Segment[] = [];
  let reasoning: Segment[] = [];
  const ordinaryWork = (segment: Segment | undefined) => {
    if (segment?.kind !== "tools") return false;
    const toolIndex = segment.indexes.find(
      (index) => parts[index].type !== "reasoning",
    );
    return (
      toolIndex !== undefined &&
      classifyTranscriptTool(parts[toolIndex]) !== "agent"
    );
  };
  for (const segment of segments) {
    if (
      segment.kind === "part" &&
      parts[segment.indexes[0]].type === "reasoning"
    ) {
      reasoning.push(segment);
      continue;
    }
    if (ordinaryWork(segment)) {
      const indexes = [
        ...reasoning.flatMap((item) => item.indexes),
        ...segment.indexes,
      ];
      const previous = compact.at(-1);
      if (ordinaryWork(previous)) previous!.indexes.push(...indexes);
      else compact.push({ kind: "tools", indexes });
    } else {
      compact.push(...reasoning, segment);
    }
    reasoning = [];
  }
  return [...compact, ...reasoning];
}

export function toolGroupSummary(
  parts: readonly TranscriptPart[],
  status: ChatStatus,
  isAwaitingApproval = false,
) {
  return summarizeTranscriptTools(parts, status, isAwaitingApproval);
}

function ToolGroup({
  parts,
  indexes,
  status,
  renderPart,
  isAwaitingApproval = false,
}: {
  parts: readonly TranscriptPart[];
  indexes: number[];
  status: ChatStatus;
  isAwaitingApproval?: boolean;
  renderPart: (index: number) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const summary = toolGroupSummary(
    indexes.map((index) => parts[index]),
    status,
    isAwaitingApproval,
  );
  const isAgentGroup = summary.category === "agent";
  const firstToolCallId = indexes
    .map((index) => parts[index].toolCallId)
    .find((id) => typeof id === "string" && id.trim());
  return (
    <div
      data-ui="transcript-tool-group"
      data-status={summary.status}
      data-has-failure={summary.failed > 0 ? "true" : undefined}
      className="not-prose min-w-0 rift-work-group"
    >
      <button
        type="button"
        aria-expanded={isAgentGroup ? undefined : open}
        aria-controls={isAgentGroup ? "agent-activity-panel" : contentId}
        onClick={() => {
          if (isAgentGroup)
            openAgentActivity(
              firstToolCallId ? { toolCallId: firstToolCallId } : {},
            );
          else setOpen((value) => !value);
        }}
        className="rift-work-summary"
      >
        <span className="rift-work-icons" aria-hidden="true">
          {summary.agents.length > 0 ? (
            summary.agents
              .slice(0, 3)
              .map((agent) => (
                <AgentActivityMark
                  key={agent.identity}
                  identity={agent.identity}
                />
              ))
          ) : (
            <ActivityIcon category={summary.category} />
          )}
        </span>
        <span className="rift-work-label">{summary.label}</span>
        {!["completed", "running"].includes(summary.detail) ? (
          <span className="rift-work-outcome">· {summary.detail}</span>
        ) : null}
        <ChevronRight
          aria-hidden="true"
          data-ui="transcript-tool-chevron"
          className="rift-work-chevron"
          strokeWidth={1.5}
        />
      </button>
      {!isAgentGroup ? (
        <div id={contentId} hidden={!open} className="rift-work-details">
          {open
            ? indexes.map((index) => (
                <Fragment key={index}>{renderPart(index)}</Fragment>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

export function AssistantTranscript({
  parts,
  status,
  renderPart,
  isAwaitingApproval = false,
}: {
  parts: readonly TranscriptPart[];
  status: ChatStatus;
  isAwaitingApproval?: boolean;
  renderPart: (index: number) => ReactNode;
}) {
  const segments = useMemo(() => transcriptSegments(parts), [parts]);
  return (
    <div data-ui="assistant-transcript" className="rift-assistant-transcript">
      {segments.map((segment) =>
        segment.kind === "tools" ? (
          <ToolGroup
            key={`tools-${segment.indexes.find((index) => parts[index].type !== "reasoning")}`}
            parts={parts}
            indexes={segment.indexes}
            status={status}
            isAwaitingApproval={isAwaitingApproval}
            renderPart={renderPart}
          />
        ) : (
          <Fragment key={`part-${segment.indexes[0]}`}>
            {renderPart(segment.indexes[0])}
          </Fragment>
        ),
      )}
    </div>
  );
}
