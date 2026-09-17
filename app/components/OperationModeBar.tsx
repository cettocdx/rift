"use client";

import { X } from "lucide-react";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { getOperation, type OperationDef } from "@/lib/operations/operations";
import { openOperationLauncher } from "@/lib/utils/operation-launcher";

/**
 * Operation-mode strip under the brand bar. Shows the active operation (badge +
 * target) and, once the agent is idle, suggested follow-up operations that open
 * the launcher pre-filled with the same target (chaining).
 */
export function OperationModeBar({ isIdle }: { isIdle: boolean }) {
  const { activeOperation, setActiveOperation } = useGlobalState();
  if (!activeOperation) return null;

  const op = getOperation(activeOperation.id);
  const Icon = op?.icon;
  const nextOps = (op?.next ?? [])
    .map(getOperation)
    .filter((o): o is OperationDef => Boolean(o));

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-muted/30 px-4 py-1.5">
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/60" />
        {Icon && (
          <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
        )}
        {activeOperation.label}
        {activeOperation.target && (
          <span className="font-mono text-muted-foreground">
            · {activeOperation.target}
          </span>
        )}
      </span>

      {isIdle && nextOps.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Next:</span>
          {nextOps.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() =>
                openOperationLauncher({
                  operationId: n.id,
                  initialTarget: activeOperation.target,
                })
              }
              className="rounded-full border border-border px-2.5 py-0.5 text-[11.5px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {n.label}
            </button>
          ))}
        </span>
      )}

      <button
        type="button"
        onClick={() => setActiveOperation(null)}
        aria-label="Exit operation mode"
        className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
