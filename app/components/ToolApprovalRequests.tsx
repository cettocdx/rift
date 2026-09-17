"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./ToolApprovalRequests.module.css";

type Approval = FunctionReturnType<typeof api.approvals.pending>[number];
const LABELS: Record<string, string> = {
  agentId: "Agent",
  task: "Task",
  context: "Context",
  command: "Command",
  path: "File",
  filePath: "File",
  cwd: "Working directory",
  content: "Content",
  old_text: "Replace",
  new_text: "With",
  description: "Description",
};
const CODE_FIELDS = new Set([
  "command",
  "content",
  "code",
  "old_text",
  "new_text",
  "oldText",
  "newText",
  "diff",
  "patch",
]);
function fieldsFromPreview(preview: string): [string, unknown][] | null {
  try {
    const value = JSON.parse(preview);
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length
    )
      return Object.entries(value);
  } catch {
    /* Truncated/non-JSON previews remain fully visible as plain text. */
  }
  return null;
}
function fieldLabel(key: string) {
  return (
    LABELS[key] ??
    key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replaceAll("_", " ")
      .replace(/^./, (s) => s.toUpperCase())
  );
}
function valueText(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** Presentational card, also used by the no-side-effects design preview. */
export function ToolApprovalCard({
  request,
  busy = false,
  onRespond,
}: {
  request: Approval;
  busy?: boolean;
  onRespond: (id: Id<"tool_approvals">, approve: boolean) => void;
}) {
  const fields = fieldsFromPreview(request.preview);
  const action = request.toolName.replaceAll("_", " ");
  const heading =
    request.toolName === "delegate_task"
      ? "Review agent task"
      : "Review action";
  return (
    <section aria-label="Action awaiting approval" className={styles.card}>
      <header className={styles.header}>
        <ShieldCheck aria-hidden className={styles.icon} />
        <div>
          <h3 className={styles.heading}>{heading}</h3>
          <p className={styles.subtitle}>
            {request.toolName === "delegate_task"
              ? "Allow RIFT to delegate this task"
              : action.charAt(0).toUpperCase() + action.slice(1)}
          </p>
        </div>
      </header>
      <div className={styles.body}>
        {fields ? (
          <>
            <dl className={styles.fields}>
              {fields.map(([key, value]) => (
                <div className={styles.field} key={key}>
                  <dt className={styles.label}>{fieldLabel(key)}</dt>
                  <dd className={styles.value}>
                    {CODE_FIELDS.has(key) ||
                    (value !== null && typeof value === "object") ? (
                      <pre className={styles.code}>{valueText(value)}</pre>
                    ) : (
                      valueText(value)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <details className={styles.details}>
              <summary>
                <ChevronRight aria-hidden />
                Technical details
              </summary>
              <pre className={styles.code}>{request.preview}</pre>
            </details>
          </>
        ) : (
          <pre className={styles.code}>{request.preview}</pre>
        )}
      </div>
      <footer className={styles.footer}>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRespond(request._id, false)}
          className={styles.button}
        >
          Deny
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRespond(request._id, true)}
          className={`${styles.button} ${styles.primary}`}
        >
          Allow once
        </button>
      </footer>
    </section>
  );
}
export function ToolApprovalRequests({
  requests: pending,
}: {
  requests: FunctionReturnType<typeof api.approvals.pending>;
}) {
  const decide = useMutation(api.approvals.decide);
  const [busy, setBusy] = useState<string | null>(null);
  async function respond(id: Id<"tool_approvals">, approve: boolean) {
    setBusy(id);
    try {
      await decide({ id, approve });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save approval",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      {pending?.map((request) => (
        <ToolApprovalCard
          key={request._id}
          request={request}
          busy={!!busy}
          onRespond={(id, approve) => void respond(id, approve)}
        />
      ))}
    </>
  );
}
