"use client";
import { useId, useState, type ReactNode } from "react";
import { ChevronRight, Check, History } from "lucide-react";
import { ActivityIcon } from "@/components/ai-elements/activity-icon";
import { MemoizedMarkdown } from "../MemoizedMarkdown";
import { FilePartRenderer } from "../FilePartRenderer";
import {
  hackResponseRange,
  hackToolSummary,
  plainToolOutput,
  redactHackCommand,
  type HackTranscriptItem,
  type HackToolItem,
} from "@/lib/hack/transcript-presentation";
import styles from "./HackTurnTranscript.module.css";

function ToolRow({ tool, running }: { tool: HackToolItem; running: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const summary = hackToolSummary(tool, running);
  return (
    <div className={styles.tool} data-status={summary.status}>
      <button
        type="button"
        className={styles.toolTrigger}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <ActivityIcon category={summary.category} />
        <span>{summary.label}</span>
        <ChevronRight size={13} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className={styles.evidence}>
          {tool.cmd && (
            <div className={styles.command}>
              <code>{redactHackCommand(tool.cmd)}</code>
            </div>
          )}
          {tool.out || tool.streamOut ? (
            <pre tabIndex={0} aria-label="Tool output">
              {plainToolOutput(tool.out || tool.streamOut)}
            </pre>
          ) : (
            <p>
              {summary.status === "running"
                ? "Waiting for output…"
                : "No text output was returned."}
            </p>
          )}
          {tool.errorText && <p className={styles.error}>{tool.errorText}</p>}
        </div>
      )}
    </div>
  );
}

export function HackTurnTranscript({
  items,
  running,
  messageId,
  interrupted = false,
  cutoffMessage,
  actions,
}: {
  items: readonly HackTranscriptItem[];
  running: boolean;
  messageId: string;
  interrupted?: boolean;
  cutoffMessage?: string;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const id = useId();
  const response = hackResponseRange(items, running);
  const partial = interrupted || Boolean(cutoffMessage);
  const work = items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item, index }) =>
        item.kind !== "file" &&
        (!response || index < response.start || index > response.end),
    );
  const tools = work.flatMap(({ item }) =>
    item.kind === "tool" ? [item] : [],
  );
  const failed = tools.filter(
    (tool) => hackToolSummary(tool, running).status === "failed",
  ).length;
  const latest = items.at(-1);
  const label = running
    ? latest?.kind === "tool"
      ? hackToolSummary(latest, true).label
      : latest?.kind === "line"
        ? "Writing response"
        : latest?.kind === "reason" && latest.state !== "done"
          ? "Thinking"
          : "Working"
    : null;
  return (
    <div className={styles.transcript}>
      {work.length > 0 && (
        <section className={styles.work}>
          <button
            type="button"
            className={styles.workTrigger}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((value) => !value)}
          >
            <History size={14} strokeWidth={1.5} aria-hidden="true" />
            <span>Work log</span>
            {tools.length > 0 && (
              <span className={styles.count}>
                {tools.length} {tools.length === 1 ? "action" : "actions"}
              </span>
            )}
            {failed > 0 && (
              <span className={styles.error}>{failed} failed</span>
            )}
            {label && <span className={styles.current}>{label}</span>}
            <ChevronRight size={13} aria-hidden="true" />
          </button>
          {open && (
            <div id={id} className={styles.workDetails}>
              {work.map(({ item, index }) =>
                item.kind === "tool" ? (
                  <ToolRow
                    key={item.toolCallId ?? index}
                    tool={item}
                    running={running}
                  />
                ) : item.kind === "reason" ? (
                  <details key={index} className={styles.reason} open>
                    <summary>Reasoning details</summary>
                    <div>
                      <MemoizedMarkdown content={item.text} />
                    </div>
                  </details>
                ) : item.kind === "line" ? (
                  <div key={index} className={styles.update}>
                    <MemoizedMarkdown content={item.text} />
                  </div>
                ) : null,
              )}
            </div>
          )}
        </section>
      )}
      {response ? (
        <section
          className={`${styles.response} answer-report`}
          role="region"
          aria-label={
            running
              ? "Live update"
              : partial
                ? "Partial response"
                : "Final response"
          }
          data-streaming={running}
        >
          <header className={styles.responseHeading}>
            {!running && !partial && <Check size={14} aria-hidden="true" />}
            <span>
              {running
                ? "Live update"
                : partial
                  ? "Partial response"
                  : "Response"}
            </span>
          </header>
          {!running && cutoffMessage && (
            <p className={styles.incomplete}>{cutoffMessage}</p>
          )}
          <div className={`${styles.copy} answer-copy`}>
            <MemoizedMarkdown content={response.text} />
          </div>
          {!running && !partial && actions}
        </section>
      ) : !running && work.length > 0 ? (
        <p className={styles.incomplete}>
          {cutoffMessage ??
            (interrupted
              ? "The run was interrupted."
              : "The run ended without a final response.")}{" "}
          The work log contains the available evidence.
        </p>
      ) : null}
      {items.map((item, index) =>
        item.kind === "file" ? (
          <FilePartRenderer
            key={index}
            part={item.part}
            partIndex={index}
            messageId={messageId}
          />
        ) : null,
      )}
    </div>
  );
}
