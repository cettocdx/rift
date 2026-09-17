import { memo, useId, useState } from "react";
import {
  Check,
  ChevronRight,
  CirclePause,
  CircleStop,
  Loader2,
  X,
} from "lucide-react";
import type { ChatStatus } from "@/types";
import { isUserStoppedToolError } from "@/lib/chat/tool-abort-utils";

interface VerificationPart {
  state?: string;
  errorText?: string;
  output?: unknown;
}
interface CheckResult {
  name?: string;
  ok?: boolean;
  detail?: string;
  command?: string;
  output?: string;
}
const labels: Record<string, string> = {
  project: "Project",
  "production-build": "Production build",
  "static-entry": "Static entry",
  "live-server": "Live server",
  "browser-runtime": "Browser runtime",
};

export const VerifyAppToolHandler = memo(function VerifyAppToolHandler({
  part,
  status,
}: {
  part: VerificationPart;
  status: ChatStatus;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const output =
    part.output && typeof part.output === "object"
      ? (part.output as {
          ok?: boolean;
          summary?: string;
          error?: string;
          checks?: CheckResult[];
        })
      : undefined;
  const checks = Array.isArray(output?.checks)
    ? output.checks.filter((check) => check && typeof check === "object")
    : [];
  const error =
    part.errorText ||
    (typeof output?.error === "string" ? output.error : undefined);
  const stopped = isUserStoppedToolError(error);
  const failed =
    !stopped &&
    (part.state === "output-error" ||
      Boolean(error) ||
      output?.ok === false ||
      checks.some((check) => check.ok === false));
  const passed =
    !stopped &&
    !failed &&
    part.state === "output-available" &&
    output?.ok === true;
  const running =
    !failed &&
    !stopped &&
    !passed &&
    status === "streaming" &&
    (part.state === "input-streaming" || part.state === "input-available");
  const label = stopped
    ? "Verification stopped"
    : failed
      ? "Verification failed"
      : passed
        ? "Verification passed"
        : running
          ? "Verifying app"
          : "Verification incomplete";
  const Icon = stopped
    ? CircleStop
    : failed
      ? X
      : passed
        ? Check
        : running
          ? Loader2
          : CirclePause;
  return (
    <div className="min-w-0" data-ui="app-verification">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-11 sm:min-h-[30px] [@media(pointer:coarse)]:min-h-11 w-full items-center gap-2 rounded-sm text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2"
      >
        <Icon
          aria-hidden="true"
          className={`size-3.5 shrink-0 ${running ? "animate-spin" : ""}`}
        />
        <span>{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 shrink-0 ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      {expanded && (
        <div
          id={detailsId}
          className="space-y-3 border-l border-border pl-4 text-xs text-muted-foreground [overflow-wrap:anywhere]"
        >
          {error && <p className="whitespace-pre-wrap">{error}</p>}
          {typeof output?.summary === "string" && <p>{output.summary}</p>}
          {!error && !checks.length && !output?.summary && (
            <p>
              {running
                ? "Waiting for verification results."
                : "No completed verification result was recorded."}
            </p>
          )}
          {checks.map((check, index) => (
            <div key={`${check.name}-${index}`} className="min-w-0 space-y-1">
              <p className="font-medium text-foreground">
                {labels[check.name ?? ""] ?? check.name ?? "Check"} ·{" "}
                {check.ok === true
                  ? "Passed"
                  : check.ok === false
                    ? "Failed"
                    : "Incomplete"}
              </p>
              {typeof check.detail === "string" && (
                <p className="whitespace-pre-wrap">{check.detail}</p>
              )}
              {typeof check.command === "string" && (
                <code className="block whitespace-pre-wrap">
                  {check.command}
                </code>
              )}
              {typeof check.output === "string" && (
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label={`${labels[check.name ?? ""] ?? check.name ?? "Check"} output`}
                  className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs focus-visible:outline focus-visible:outline-2"
                >
                  {check.output}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
