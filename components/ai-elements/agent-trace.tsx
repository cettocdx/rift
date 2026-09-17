"use client";

import type { ReactNode } from "react";
import {
  Edit,
  Eye,
  FileDown,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  Lightbulb,
  ListTodo,
  MonitorPlay,
  Search,
  ShieldCheck,
  StickyNote,
  Terminal,
  Users,
} from "lucide-react";
import { MemoizedMarkdown } from "@/app/components/MemoizedMarkdown";
import {
  ACTIVITY_ARG_CLASS,
  ACTIVITY_ARG_MONO_CLASS,
  ACTIVITY_CONNECTOR_CLASS,
  ACTIVITY_CONNECTOR_TICK_CLASS,
  ACTIVITY_ICON_CLASS,
  ACTIVITY_LABEL_GROUP_CLASS,
  ACTIVITY_ROW_CLASS,
  ACTIVITY_VERB_CLASS,
} from "@/lib/ui/workspace-chrome";

/**
 * The run, rendered in Grok's trace grammar (measured 17 Aug 2026 — see
 * docs/product-transformation/grok-agent-behaviour-2026-08-17.md).
 *
 * Three kinds of line and nothing else:
 *
 *   - prose, full contrast, only where the model wrote it (decision points);
 *   - activity rows — icon + verb + de-emphasised argument on one 24px line,
 *     the verb in present tense with a light sweep while running and in past
 *     tense once done;
 *   - a 1x5px connector tick between rows.
 *
 * Deliberately absent: tool cards, terminal output, diffs, status columns,
 * step numbers. The trace is the story of the run; the evidence lives in the
 * Agent Activity panel.
 */

type TracePart = {
  type?: string;
  state?: string;
  text?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
};

type ActivityRow = {
  kind: "row";
  icon: ReactNode;
  verb: string;
  argument?: string;
  mono?: boolean;
  running?: boolean;
  error?: boolean;
  /** Rows sharing a non-empty groupKey and verb collapse into one counted row. */
  groupKey?: string;
};

type ProseLine = { kind: "prose"; text: string };

type TraceLine = ActivityRow | ProseLine;

const TRACE_ICON = "size-[14px] stroke-[1]";

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const basename = (value: string): string =>
  value.split("/").filter(Boolean).pop() ?? value;

const isRunning = (part: TracePart): boolean =>
  part.state !== "output-available" && part.state !== "output-error";

const outputField = (part: TracePart, field: string): unknown =>
  typeof part.output === "object" && part.output !== null
    ? (part.output as Record<string, unknown>)[field]
    : undefined;

/** File-action verbs, present participle while running, terse past when done. */
const FILE_VERBS: Record<string, [running: string, done: string]> = {
  viewing: ["Viewing", "Viewed"],
  reading: ["Reading", "Read"],
  creating: ["Creating", "Wrote"],
  editing: ["Editing", "Edited"],
  writing: ["Writing", "Wrote"],
  searching: ["Searching", "Searched"],
  appending: ["Appending to", "Appended to"],
};

function partToLine(part: TracePart): TraceLine | null {
  const type = part.type ?? "";
  const running = isRunning(part);
  const failed = part.state === "output-error";
  const brief = str(part.input?.brief);

  if (type === "reasoning" || type === "text") {
    const text = str(part.text);
    return text ? { kind: "prose", text } : null;
  }

  switch (type) {
    case "tool-run_terminal_cmd":
    case "tool-interact_terminal_session": {
      const command = str(part.input?.command);
      return {
        kind: "row",
        icon: <Terminal className={TRACE_ICON} />,
        verb: running ? "Running command" : "Ran command",
        argument: brief ?? command,
        mono: !brief && !!command,
        running,
        error: failed,
      };
    }
    case "tool-file": {
      const action = str(part.input?.action) ?? "editing";
      const [live, done] = FILE_VERBS[action] ?? ["Editing", "Edited"];
      const path = str(part.input?.path) ?? str(part.input?.file_path);
      const isEdit = action === "editing" || action === "writing" || action === "creating" || action === "appending";
      return {
        kind: "row",
        icon:
          action === "viewing" || action === "reading" ? (
            <Eye className={TRACE_ICON} />
          ) : action === "searching" ? (
            <Search className={TRACE_ICON} />
          ) : (
            <Edit className={TRACE_ICON} />
          ),
        verb: running ? live : done,
        argument: path ? basename(path) : undefined,
        running,
        error: failed,
        groupKey: !running && isEdit ? "file-write" : undefined,
      };
    }
    case "tool-web_search":
      return {
        kind: "row",
        icon: <Search className={TRACE_ICON} />,
        verb: running ? "Searching web" : "Searched web",
        argument: str(part.input?.query),
        running,
        error: failed,
      };
    case "tool-find_skills": {
      // Loading playbooks is automatic — which ones is plumbing, not story.
      // The row states only that it happened, with Grok's aggregated count.
      const ids = outputField(part, "loadedSkillIds");
      const count = Array.isArray(ids) ? ids.length : 0;
      return {
        kind: "row",
        icon: <LayoutGrid className={TRACE_ICON} />,
        verb: running
          ? "Loading skills"
          : count > 0
            ? `Loaded ${count} skill${count === 1 ? "" : "s"}`
            : "Checked skills",
        running,
        error: failed,
      };
    }
    case "tool-verify_app": {
      const ok = outputField(part, "ok");
      return {
        kind: "row",
        icon: <ShieldCheck className={TRACE_ICON} />,
        verb: running
          ? "Verifying the app"
          : ok === false
            ? "Verification failed"
            : "Verified the app",
        argument: brief,
        running,
        error: failed || ok === false,
      };
    }
    case "tool-expose_preview": {
      const url = str(outputField(part, "url"));
      return {
        kind: "row",
        icon: <MonitorPlay className={TRACE_ICON} />,
        verb: running ? "Opening preview" : url ? "Preview live" : "Preview failed",
        argument: url,
        mono: !!url,
        running,
        error: failed || (!running && !url),
      };
    }
    case "tool-generate_image":
    case "tool-generate_video":
      return {
        kind: "row",
        icon: <ImageIcon className={TRACE_ICON} />,
        verb: running
          ? type === "tool-generate_video"
            ? "Generating video"
            : "Generating image"
          : type === "tool-generate_video"
            ? "Generated video"
            : "Generated image",
        argument: brief,
        running,
        error: failed,
      };
    case "tool-todo_write": {
      const todos = part.input?.todos;
      const active = Array.isArray(todos)
        ? (todos as Array<{ status?: string; content?: string }>).find(
            (todo) => todo.status === "in_progress",
          )?.content
        : undefined;
      return {
        kind: "row",
        icon: <ListTodo className={TRACE_ICON} />,
        verb: running ? "Updating plan" : "Updated plan",
        argument: str(active),
        running,
        error: failed,
      };
    }
    case "tool-delegate_task":
      return {
        kind: "row",
        icon: <Users className={TRACE_ICON} />,
        verb: running ? "Delegating" : "Delegated",
        argument: brief ?? str(part.input?.task),
        running,
        error: failed,
      };
    case "tool-browse_url":
    case "tool-open_url":
      return {
        kind: "row",
        icon: <Globe className={TRACE_ICON} />,
        verb: running ? "Reading page" : "Read page",
        argument: str(part.input?.url),
        mono: true,
        running,
        error: failed,
      };
    case "tool-get_terminal_files":
      return {
        kind: "row",
        icon: <FileDown className={TRACE_ICON} />,
        verb: running ? "Sharing files" : "Shared files",
        argument: brief,
        running,
        error: failed,
      };
    case "tool-create_note":
    case "tool-update_note":
    case "tool-list_notes":
    case "tool-delete_note":
      return {
        kind: "row",
        icon: <StickyNote className={TRACE_ICON} />,
        verb: running ? "Updating notes" : "Updated notes",
        running,
        error: failed,
      };
    default: {
      if (!type.startsWith("tool-")) return null;
      const name = type.slice(5).replaceAll("_", " ");
      return {
        kind: "row",
        icon: <Lightbulb className={TRACE_ICON} />,
        verb: running ? `Running ${name}` : `Ran ${name}`,
        argument: brief,
        running,
        error: failed,
      };
    }
  }
}

/** Collapse consecutive completed same-verb write rows: "Edited 3 files". */
function aggregate(lines: TraceLine[]): TraceLine[] {
  const out: TraceLine[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    if (
      line.kind === "row" &&
      previous?.kind === "row" &&
      line.groupKey &&
      previous.groupKey === line.groupKey &&
      previous.verb.split(" ")[0] === line.verb.split(" ")[0]
    ) {
      const verb = line.verb.split(" ")[0];
      const count =
        (Number(/^(\d+) files$/.exec(previous.argument ?? "")?.[1]) || 1) + 1;
      out[out.length - 1] = {
        ...previous,
        verb,
        argument: `${count} files`,
        mono: false,
      };
      continue;
    }
    out.push(line);
  }
  return out;
}

export function AgentTrace({ parts }: { parts: readonly unknown[] }) {
  const lines = aggregate(
    (parts as TracePart[])
      .map(partToLine)
      .filter((line): line is TraceLine => line !== null),
  );
  if (lines.length === 0) return null;

  return (
    <div data-ui="agent-trace" className="space-y-2">
      {lines.map((line, index) => {
        if (line.kind === "prose") {
          return (
            <div key={`prose-${index}`} className="py-1">
              <MemoizedMarkdown content={line.text} />
            </div>
          );
        }
        const next = lines[index + 1];
        return (
          <div key={`row-${index}`} className="!my-0">
            <div className={ACTIVITY_ROW_CLASS}>
              <span
                className={`${ACTIVITY_ICON_CLASS} ${line.error ? "!text-destructive" : ""}`}
              >
                {line.icon}
              </span>
              <span className={ACTIVITY_LABEL_GROUP_CLASS}>
                <span
                  className={`${ACTIVITY_VERB_CLASS} ${
                    line.running
                      ? "rift-thinking-shimmer"
                      : line.error
                        ? "!text-destructive"
                        : ""
                  }`}
                >
                  {line.verb}
                </span>
                {line.argument ? (
                  <span
                    className={
                      line.mono ? ACTIVITY_ARG_MONO_CLASS : ACTIVITY_ARG_CLASS
                    }
                  >
                    {line.argument}
                  </span>
                ) : null}
              </span>
            </div>
            {next?.kind === "row" ? (
              <div className={ACTIVITY_CONNECTOR_CLASS} aria-hidden>
                <span className={ACTIVITY_CONNECTOR_TICK_CLASS} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
