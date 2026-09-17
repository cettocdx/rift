"use client";

import { ShieldCheck, Info, TriangleAlert } from "lucide-react";
import {
  resolveEffectivePermissions,
  type EffectivePermissionLine,
} from "@/lib/ai/agents/effective-permissions";
import { READ_ONLY_AGENT_BASE_TOOL_IDS } from "@/lib/ai/agents/read-only-tools";
import type { CustomAgentProfileConfig } from "@/lib/ai/agents/pet-roster";

/**
 * What this agent will actually be able to do, shown before it is saved.
 *
 * The editor already showed the reader their own form back. That answers "what
 * did I choose", not "what will this agent be able to do" -- and the two differ,
 * because the runtime narrows a profile in ways the form never mentions. The
 * gap is where a dangerous assumption lives: a ticked terminal tool on a
 * read-only agent reads as granted and is not.
 */

function EnforcementTag({
  kind,
}: {
  kind: EffectivePermissionLine["enforcement"];
}) {
  const enforced = kind === "enforced";
  return (
    <span
      className={`shrink-0 rounded px-1 py-px text-[9px] uppercase tracking-[0.06em] ${
        enforced
          ? "bg-[var(--success)]/12 text-[var(--success)]"
          : "bg-[var(--warning)]/12 text-[var(--warning)]"
      }`}
      title={
        enforced
          ? "The runtime enforces this. The agent cannot exceed it."
          : "Guidance in the agent's instructions. It is not a hard stop."
      }
    >
      {enforced ? "Enforced" : "Advisory"}
    </span>
  );
}

function Line({ line }: { line: EffectivePermissionLine }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="w-[88px] shrink-0 text-ui-caption text-muted-foreground">
          {line.label}
        </span>
        <span className="min-w-0 flex-1 text-ui-label leading-4 text-foreground">
          {line.value}
        </span>
        <EnforcementTag kind={line.enforcement} />
      </div>
      {line.note ? (
        <p className="pl-[96px] text-ui-caption leading-4 text-muted-foreground/80">
          {line.note}
        </p>
      ) : null}
    </div>
  );
}

export function EffectivePermissionsPanel({
  profile,
  availableMcpToolIdsByServer,
}: {
  profile: Pick<
    CustomAgentProfileConfig,
    | "permissionPreset"
    | "toolIds"
    | "mcpServerIds"
    | "concurrencyLimit"
    | "escalationPolicy"
    | "approvalPolicy"
    | "autonomy"
  >;
  availableMcpToolIdsByServer?: Record<string, readonly string[]>;
}) {
  const effective = resolveEffectivePermissions({
    profile,
    readOnlyBaseToolIds: READ_ONLY_AGENT_BASE_TOOL_IDS,
    availableMcpToolIdsByServer,
  });

  return (
    <section
      data-ui="effective-permissions"
      aria-label="Effective permissions"
      className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2"
    >
      <header className="flex items-center gap-1.5 pb-1">
        <ShieldCheck aria-hidden className="size-3.5 text-muted-foreground" />
        <h3 className="text-ui-label font-medium text-foreground">
          What this agent will be able to do
        </h3>
      </header>

      <div className="divide-y divide-border/50">
        <Line line={effective.filesystem} />
        <Line line={effective.network} />
        <Line line={effective.concurrency} />
        <Line line={effective.autonomy} />
        <Line line={effective.escalation} />
        <Line line={effective.approval} />
      </div>

      <div className="mt-2 border-t border-border/50 pt-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="w-[88px] shrink-0 text-ui-caption text-muted-foreground">
            Tools
          </span>
          <span className="min-w-0 flex-1 text-ui-label leading-4 text-foreground">
            {effective.grantedToolIds.length > 0
              ? `${effective.grantedToolIds.length} granted`
              : "None granted"}
          </span>
        </div>

        {effective.withheldToolIds.length > 0 ? (
          // The whole reason this panel exists: a ticked box the runtime will
          // ignore reads as granted, and it is not.
          <div
            role="status"
            className="mt-1.5 flex items-start gap-1.5 rounded-md bg-[var(--warning)]/[0.08] px-2 py-1.5"
          >
            <TriangleAlert
              aria-hidden
              className="mt-px size-3 shrink-0 text-[var(--warning)]"
            />
            <p className="text-ui-caption leading-4 text-[var(--warning)]">
              A read-only agent cannot use{" "}
              <span className="font-medium">
                {effective.withheldToolIds.join(", ")}
              </span>
              . {effective.withheldToolIds.length === 1 ? "It is" : "They are"}{" "}
              selected but will not be available at run time.
            </p>
          </div>
        ) : (
          <p className="mt-1 flex items-start gap-1.5 text-ui-caption leading-4 text-muted-foreground/80">
            <Info aria-hidden className="mt-px size-3 shrink-0" />
            Every selected tool is available under this permission level.
          </p>
        )}
      </div>
    </section>
  );
}
